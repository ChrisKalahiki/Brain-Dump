import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { countOf } from "./check.ts";
import { claudeSessionFiles, readClaudeSession } from "./claude-sessions.ts";
import { codexSessionFiles, readCodexSession } from "./codex-sessions.ts";
import { now } from "./clock.ts";
import { prepareDump, SecretRefusedError, writeDumps, type PreparedDump } from "./dump.ts";
import { BrainDumpError, errnoCode } from "./errors.ts";
import { canonical, isInside } from "./guard.ts";
import { coveredSessions } from "./inbox.ts";
import { INBOX } from "./layout.ts";
import { datePart, detectDevOrigin, type DevOrigin } from "./origin.ts";
import { NO_ITEMS_REPLY, sweepDraftPrompt } from "./prompts.ts";
import { stateFolder } from "./runs.ts";
import type { SessionMessage, Transcript } from "./transcript.ts";
import { expandHome, readSetting, type Vault } from "./vault.ts";

// The Sweep (ADR 0009): drafts one Dump per recent uncaptured Session, each through its own tool-less, unsaved agent run, and writes them all as one Run.

const LOOKBACK_DAYS = 28;
const ACTIVE_HOURS = 2;
const MIN_USER_MESSAGES = 3;
const SESSION_CAP = 25;
const TEXT_CAP = 150_000;
const AGENT_TIMEOUT_MS = 10 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** The pinned model every Session is drafted with. */
const DRAFTING_MODEL = "claude-sonnet-5-5";
const DRAFTING_COMMAND = ["claude", "-p", "--no-session-persistence", "--model", DRAFTING_MODEL, "--tools", "", "--strict-mcp-config", "--safe-mode"];
/** A shell command run in place of the drafting agent, so tests substitute a stub. It gets the prompt on stdin like the agent. */
const AGENT_VARIABLE = "BRAIN_DUMP_DRAFT_AGENT";
const OPT_OUT_SETTING = "sweep-opt-out";

/** One per tool: its Session logs, and how to read one; a reader gives `undefined` for a log the Sweep never drafts. */
const READERS: { files: () => string[]; read: (file: string) => Transcript | undefined }[] = [
  { files: claudeSessionFiles, read: readClaudeSession },
  { files: codexSessionFiles, read: readCodexSession },
];

export type SweepSummary = {
  time: string;
  /** The Run that wrote the Dumps; `null` when none was written. */
  run: string | null;
  written: { session: string; dump: string }[];
  /** Sessions read and judged to hold nothing worth keeping. */
  skipped: { session: string }[];
  unreadable: { file: string }[];
  secretRefused: { session: string; line: number; kind: string }[];
  carriedOver: { session: string }[];
  errors: { session?: string; error: string }[];
};

/** `coveredUntil` is where the next Sweep's window starts; `retry` holds the files it reads whatever their age in the window. */
type SweepState = { last: SweepSummary; coveredUntil?: string; retry: string[] };

/** Session id → the time of the last record already covered by a Dump or judged not worth keeping. */
type Covered = Map<string, Date>;

type Candidate = { transcript: Transcript & { cwd: string }; messages: SessionMessage[] };

export function sweep(vault: Vault): SweepSummary {
  return withLock(() => {
    const at = now();
    const state = readState();
    const summary: SweepSummary = { time: at.toISOString(), run: null, written: [], skipped: [], unreadable: [], secretRefused: [], carriedOver: [], errors: [] };
    const candidates = findCandidates(vault, at, state, summary);
    const ledger = readLedger();
    const drafted: { session: string; dump: PreparedDump }[] = [];
    let stopped = false;
    for (const [index, candidate] of candidates.slice(0, SESSION_CAP).entries()) {
      const outcome = draft(candidate);
      const { session } = candidate.transcript;
      if (outcome.kind === "agent-failed") {
        summary.errors.push({ session, error: outcome.error });
        summary.carriedOver.push(...candidates.slice(index, SESSION_CAP).map(({ transcript }) => ({ session: transcript.session })));
        stopped = true;
        break;
      }
      if (outcome.kind === "no-items") {
        ledger[session] = candidate.transcript.lastRecord.toISOString();
        summary.skipped.push({ session });
      } else if (outcome.kind === "secret") {
        summary.secretRefused.push({ session, line: outcome.line, kind: outcome.secretKind });
      } else if (outcome.kind === "invalid") {
        summary.errors.push({ session, error: outcome.error });
      } else {
        drafted.push({ session, dump: outcome.dump });
      }
    }
    const carried = candidates.slice(SESSION_CAP);
    summary.carriedOver.push(...carried.map(({ transcript }) => ({ session: transcript.session })));
    if (drafted.length > 0) {
      try {
        const { run, paths } = writeDumps(vault, { command: "sweep", label: `swept ${countOf(drafted.length, "Dump")}` }, drafted.map(({ dump }) => dump));
        summary.run = run;
        summary.written = drafted.map(({ session }, index) => ({ session, dump: join(INBOX, basename(paths[index] ?? "")) }));
      } catch (error) {
        if (!(error instanceof BrainDumpError)) throw error;
        summary.errors.push({ error: `no Dumps written: ${error.message}` });
        summary.carriedOver.push(...drafted.map(({ session }) => ({ session })));
        stopped = true;
      }
    }
    writeLedger(ledger);
    const retryNext = new Set(summary.carriedOver.map(({ session }) => session));
    writeState({
      last: summary,
      coveredUntil: stopped ? state?.coveredUntil : new Date(at.getTime() - ACTIVE_HOURS * HOUR_MS).toISOString(),
      retry: [...summary.unreadable.map(({ file }) => file), ...candidates.filter(({ transcript }) => retryNext.has(transcript.session)).map(({ transcript }) => transcript.file)],
    });
    return summary;
  });
}

/** The last Sweep's summary on this machine. */
export function lastSweep(): SweepSummary {
  const state = readState();
  if (state === undefined) throw new BrainDumpError("no Sweep has run on this machine");
  return state.last;
}

/** Sessions with records since the last successful Sweep and no newer than the active cutoff, at most 28 days back, newest first. */
function findCandidates(vault: Vault, at: Date, state: SweepState | undefined, summary: SweepSummary): Candidate[] {
  const oldest = at.getTime() - LOOKBACK_DAYS * 24 * HOUR_MS;
  const since = Math.max(oldest, state?.coveredUntil === undefined ? oldest : new Date(state.coveredUntil).getTime());
  const activeCutoff = at.getTime() - ACTIVE_HOURS * HOUR_MS;
  const retry = new Set(state?.retry ?? []);
  const covered = mergeCovered(coveredSessions(vault), readLedger());
  const excluded = [vault.root, ...optOutPaths()].map(canonical);
  const candidates: Candidate[] = [];
  for (const { file, read } of READERS.flatMap(({ files, read }) => files().map((file) => ({ file, read })))) {
    const floor = retry.has(file) ? oldest : since;
    const transcript = readIfChanged(file, floor, read);
    if (transcript === undefined) continue;
    const last = transcript.lastRecord.getTime();
    if (last <= floor || last > activeCutoff) continue;
    const { cwd } = transcript;
    if (cwd !== undefined && excluded.some((root) => isInside(canonical(cwd), root))) continue;
    if (cwd === undefined || !transcript.messages.some(({ role }) => role === "user")) {
      summary.unreadable.push({ file });
      continue;
    }
    const from = covered.get(transcript.session);
    if (from !== undefined && last <= from.getTime()) continue;
    const messages = from === undefined ? transcript.messages : transcript.messages.filter((message) => message.at > from);
    if (messages.filter(({ role }) => role === "user").length < MIN_USER_MESSAGES) continue;
    candidates.push({ transcript: { ...transcript, cwd }, messages });
  }
  return candidates.sort((a, b) => b.transcript.lastRecord.getTime() - a.transcript.lastRecord.getTime());
}

/** The log, unless it hasn't changed since `floor`; a log its tool removed meanwhile is passed over. */
function readIfChanged(file: string, floor: number, read: (file: string) => Transcript | undefined): Transcript | undefined {
  try {
    return statSync(file).mtime.getTime() <= floor ? undefined : read(file);
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

type DraftOutcome =
  | { kind: "dump"; dump: PreparedDump }
  | { kind: "no-items" }
  | { kind: "secret"; line: number; secretKind: string }
  | { kind: "invalid"; error: string }
  | { kind: "agent-failed"; error: string };

function draft({ transcript, messages }: Candidate): DraftOutcome {
  const { text, truncated } = renderTranscript(messages);
  const reply = runAgent(sweepDraftPrompt(text));
  if (!reply.ok) return { kind: "agent-failed", error: reply.error };
  const parsed = parseReply(reply.stdout);
  if (parsed.kind === "no-items") return parsed;
  if (parsed.kind === "off-contract") return { kind: "agent-failed", error: `drafting agent replied outside its output contract: ${parsed.firstLine}` };
  const notes = [...(transcript.startsAfterCompaction ? ["earlier part missing"] : []), ...(truncated ? ["truncated"] : [])];
  const origin: DevOrigin = { ...sessionOrigin(transcript), swept: true, notes };
  try {
    return { kind: "dump", dump: prepareDump(origin, parsed.slug, parsed.body, { id: transcript.session, through: transcript.lastRecord }) };
  } catch (error) {
    if (error instanceof SecretRefusedError) return { kind: "secret", line: error.line, secretKind: error.kind };
    if (error instanceof BrainDumpError) return { kind: "invalid", error: `invalid draft: ${error.message}` };
    throw error;
  }
}

/** The Session's own place and branch, at its last record; a folder that is gone since is named as it was. */
function sessionOrigin({ tool, cwd, branch, lastRecord }: Candidate["transcript"]): Omit<DevOrigin, "swept"> {
  if (!existsSync(cwd)) return { kind: "dev", tool, project: basename(cwd), location: cwd, branch, at: lastRecord };
  return { ...detectDevOrigin(tool, cwd, lastRecord), branch };
}

/** User and assistant text in order; over the cap, the head and the tail are kept. */
function renderTranscript(messages: SessionMessage[]): { text: string; truncated: boolean } {
  const text = messages.map(({ role, text, at }) => `[${datePart(at)} ${at.toTimeString().slice(0, 5)}] ${role === "user" ? "User" : "Assistant"}:\n${text}`).join("\n\n");
  if (text.length <= TEXT_CAP) return { text, truncated: false };
  const half = TEXT_CAP / 2;
  return { text: `${text.slice(0, half)}\n\n[… ${text.length - TEXT_CAP} characters left out …]\n\n${text.slice(-half)}`, truncated: true };
}

function runAgent(prompt: string): { ok: true; stdout: string } | { ok: false; error: string } {
  const override = process.env[AGENT_VARIABLE];
  const command = override === undefined || override === "" ? DRAFTING_COMMAND : ["sh", "-c", override];
  try {
    const result = Bun.spawnSync(command, { stdin: Buffer.from(prompt), cwd: homedir(), timeout: AGENT_TIMEOUT_MS });
    if (result.exitCode === 0) return { ok: true, stdout: result.stdout.toString() };
    const said = (result.stderr.toString().trim() || result.stdout.toString().trim()).split("\n")[0];
    return { ok: false, error: `drafting agent failed (${result.exitCode === null ? "timed out" : `exit ${result.exitCode}`})${said ? `: ${said}` : ""}` };
  } catch (error) {
    return { ok: false, error: `cannot run the drafting agent: ${error instanceof Error ? error.message : String(error)}` };
  }
}

type Reply = { kind: "draft"; slug: string; body: string } | { kind: "no-items" } | { kind: "off-contract"; firstLine: string };

/** A reply that neither starts with a `Slug:` line nor says `No Items` is the agent failing (an error printed with exit 0), not a bad draft. */
function parseReply(stdout: string): Reply {
  const reply = stdout.trim();
  if (reply === NO_ITEMS_REPLY) return { kind: "no-items" };
  const [first = "", ...rest] = reply.split("\n");
  const slug = /^Slug:\s*(.+)$/.exec(first.trim())?.[1];
  if (slug === undefined) return { kind: "off-contract", firstLine: first.trim() };
  const body = rest.join("\n").trim().replace(/^```(?:markdown)?\n([\s\S]*)\n```$/, "$1");
  return { kind: "draft", slug, body: `${body}\n` };
}

function mergeCovered(dumped: Covered, ledger: Record<string, string>): Covered {
  for (const [session, through] of Object.entries(ledger)) dumped.set(session, latest(dumped.get(session), new Date(through)));
  return dumped;
}

function latest(a: Date | undefined, b: Date): Date {
  return a === undefined || b > a ? b : a;
}

/** `sweep-opt-out = <path>, <path>` in the config: repos the Sweep never reads. */
function optOutPaths(): string[] {
  return (readSetting(OPT_OUT_SETTING) ?? "")
    .split(",")
    .map((path) => path.trim())
    .filter((path) => path !== "")
    .map(expandHome);
}

/** Holds the per-machine lock for the whole Sweep. The lock file appears with its pid already in it, so it is never read half-written; one left by a process that is gone is taken over. */
function withLock<T>(work: () => T): T {
  const path = join(stateFolder(), "sweep.lock");
  const claim = `${path}.${process.pid}`;
  mkdirSync(stateFolder(), { recursive: true });
  writeFileSync(claim, String(process.pid));
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        linkSync(claim, path);
        break;
      } catch (error) {
        if (errnoCode(error) !== "EEXIST") throw error;
        const holder = Number(readFileSync(path, "utf8"));
        if (attempt > 0 || isAlive(holder)) throw new BrainDumpError(`another Sweep is running (pid ${holder})`);
        rmSync(path, { force: true });
      }
    }
  } finally {
    rmSync(claim, { force: true });
  }
  try {
    return work();
  } finally {
    rmSync(path, { force: true });
  }
}

function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errnoCode(error) === "EPERM";
  }
}

function readState(): SweepState | undefined {
  return readJson<SweepState>(join(stateFolder(), "sweep.json"));
}

function writeState(state: SweepState): void {
  writeAtomically(join(stateFolder(), "sweep.json"), state);
}

/** The skip ledger: Sessions judged not worth keeping, through the last record read. */
function readLedger(): Record<string, string> {
  return readJson<Record<string, string>>(join(stateFolder(), "sweep-ledger.json")) ?? {};
}

/** Brain-Dump wrote the file itself, so its shape is trusted; a file that isn't JSON is named rather than crashing the Sweep. */
function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    if (error instanceof SyntaxError) throw new BrainDumpError(`${path} is not valid JSON; delete it to start the Sweep's state afresh`);
    throw error;
  }
}

function writeLedger(ledger: Record<string, string>): void {
  writeAtomically(join(stateFolder(), "sweep-ledger.json"), ledger);
}

function writeAtomically(path: string, value: unknown): void {
  writeFileSync(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}
