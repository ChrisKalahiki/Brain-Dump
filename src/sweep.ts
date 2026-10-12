import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, closeSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { countOf } from "./check.ts";
import { claudeSessionFiles, readClaudeSession, type SessionMessage, type Transcript } from "./claude-sessions.ts";
import { now } from "./clock.ts";
import { prepareDump, SecretRefusedError, writeDumps, type PreparedDump } from "./dump.ts";
import { BrainDumpError, errnoCode } from "./errors.ts";
import { canonical, isInside } from "./guard.ts";
import { FILED_FOLDER, INBOX } from "./layout.ts";
import { datePart, detectDevOrigin, type DevOrigin } from "./origin.ts";
import { NO_ITEMS_REPLY, sweepDraftPrompt } from "./prompts.ts";
import { stateFolder } from "./runs.ts";
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
export const DRAFTING_MODEL = "claude-sonnet-5-5";
const DRAFTING_COMMAND = ["claude", "-p", "--no-session-persistence", "--model", DRAFTING_MODEL, "--tools", "", "--strict-mcp-config", "--safe-mode"];
/** A shell command run in place of the drafting agent, so tests substitute a stub. It gets the prompt on stdin like the agent. */
const AGENT_VARIABLE = "BRAIN_DUMP_DRAFT_AGENT";
const OPT_OUT_SETTING = "sweep-opt-out";

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
  const covered = mergeCovered(dumpedSessions(vault), readLedger());
  const excluded = [vault.root, ...optOutPaths()].map(canonical);
  const candidates: Candidate[] = [];
  for (const file of claudeSessionFiles()) {
    const floor = retry.has(file) ? oldest : since;
    if (statSync(file).mtime.getTime() <= floor) continue;
    const transcript = readClaudeSession(file);
    const last = transcript.lastRecord.getTime();
    if (last <= floor || last > activeCutoff) continue;
    const { cwd } = transcript;
    if (cwd === undefined || !transcript.messages.some(({ role }) => role === "user")) {
      summary.unreadable.push({ file });
      continue;
    }
    if (excluded.some((root) => isInside(canonical(cwd), root))) continue;
    const from = covered.get(transcript.session);
    if (from !== undefined && last <= from.getTime()) continue;
    const messages = from === undefined ? transcript.messages : transcript.messages.filter((message) => message.at > from);
    if (messages.filter(({ role }) => role === "user").length < MIN_USER_MESSAGES) continue;
    candidates.push({ transcript: { ...transcript, cwd }, messages });
  }
  return candidates.sort((a, b) => b.transcript.lastRecord.getTime() - a.transcript.lastRecord.getTime());
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
  if (parsed === "no-items") return { kind: "no-items" };
  if (typeof parsed === "string") return { kind: "invalid", error: `invalid draft: ${parsed}` };
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
function sessionOrigin({ cwd, branch, lastRecord }: Candidate["transcript"]): Omit<DevOrigin, "swept"> {
  if (!existsSync(cwd)) return { kind: "dev", tool: "ClaudeCode", project: basename(cwd), location: cwd, branch, at: lastRecord };
  return { ...detectDevOrigin("ClaudeCode", cwd, lastRecord), branch };
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

/** The slug and body, `no-items`, or why the reply breaks the output contract. */
function parseReply(stdout: string): { slug: string; body: string } | "no-items" | string {
  const reply = stdout.trim();
  if (reply === NO_ITEMS_REPLY) return "no-items";
  const [first = "", ...rest] = reply.split("\n");
  const slug = /^Slug:\s*(.+)$/.exec(first.trim())?.[1];
  if (slug === undefined) return "the reply does not start with a Slug: line";
  const body = rest.join("\n").trim().replace(/^```(?:markdown)?\n([\s\S]*)\n```$/, "$1");
  return { slug, body: `${body}\n` };
}

/** Each Session a Dump in `Inbox/` or `Inbox/Filed/` covers, through the latest `through` among them. */
function dumpedSessions(vault: Vault): Covered {
  const covered: Covered = new Map();
  for (const folder of [INBOX, FILED_FOLDER].map((name) => join(vault.root, name))) {
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder).filter((entry) => entry.endsWith(".md"))) {
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(join(folder, name), "utf8"))?.[1] ?? "";
      const session = /^session: (\S+)$/m.exec(frontmatter)?.[1];
      const through = new Date(/^through: (\S+)$/m.exec(frontmatter)?.[1] ?? "");
      if (session !== undefined && !Number.isNaN(through.getTime())) covered.set(session, latest(covered.get(session), through));
    }
  }
  return covered;
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

/** Holds the per-machine lock for the whole Sweep; a lock left by a process that is gone is taken over. */
function withLock<T>(work: () => T): T {
  const path = join(stateFolder(), "sweep.lock");
  mkdirSync(stateFolder(), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      break;
    } catch (error) {
      if (errnoCode(error) !== "EEXIST" || attempt > 0) throw error;
      const holder = Number(readFileSync(path, "utf8"));
      if (isAlive(holder)) throw new BrainDumpError(`another Sweep is running (pid ${holder})`);
      rmSync(path, { force: true });
    }
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
  const path = join(stateFolder(), "sweep.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as SweepState) : undefined;
}

function writeState(state: SweepState): void {
  writeAtomically(join(stateFolder(), "sweep.json"), state);
}

/** The skip ledger: Sessions judged not worth keeping, through the last record read. */
function readLedger(): Record<string, string> {
  const path = join(stateFolder(), "sweep-ledger.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, string>) : {};
}

function writeLedger(ledger: Record<string, string>): void {
  writeAtomically(join(stateFolder(), "sweep-ledger.json"), ledger);
}

function writeAtomically(path: string, value: unknown): void {
  writeFileSync(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}
