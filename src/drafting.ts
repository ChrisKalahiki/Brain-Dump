import { homedir } from "node:os";
import { checkCoverage, prepareDump, SecretRefusedError, type CoveredSession, type PreparedDump } from "./dump.ts";
import { BrainDumpError } from "./errors.ts";
import type { DevOrigin } from "./origin.ts";
import { NO_ITEMS_REPLY, sweepDraftPrompt } from "./prompts.ts";

// The drafting agent (ADR 0009): one Session's text, capped, drafted by a tool-less, unsaved run of the pinned model, its reply held to the Sweep's
// contract and checked as `write-dump` checks a body.

const TEXT_CAP = 150_000;
const AGENT_TIMEOUT_MS = 10 * 60 * 1000;

/** The pinned model every Session is drafted with. */
export const DRAFTING_MODEL = "claude-sonnet-5-5";
const DRAFTING_COMMAND = ["claude", "-p", "--no-session-persistence", "--model", DRAFTING_MODEL, "--tools", "", "--strict-mcp-config", "--safe-mode"];
/** A shell command run in place of the drafting agent, so tests substitute a stub. It gets the prompt on stdin like the agent. */
export const AGENT_VARIABLE = "BRAIN_DUMP_DRAFT_AGENT";

export type Draft =
  | { kind: "dump"; slug: string; body: string; dump: PreparedDump }
  | { kind: "no-items" }
  /** The reply neither starts with a `Slug:` line nor says `No Items`: the agent failing (an error printed with exit 0), not a bad draft. */
  | { kind: "off-contract"; firstLine: string }
  | { kind: "secret"; line: number; secretKind: string }
  | { kind: "invalid"; error: string }
  | { kind: "agent-failed"; error: string };

export function draft(text: string, origin: DevOrigin, session: CoveredSession): Draft {
  try {
    checkCoverage({ origin, swept: true, session: session.id, through: session.through });
  } catch (error) {
    if (error instanceof BrainDumpError) return { kind: "invalid", error: `not drafted: ${error.message}` };
    throw error;
  }
  const { text: capped, truncated } = capText(text);
  const reply = runAgent(sweepDraftPrompt(capped));
  if (!reply.ok) return { kind: "agent-failed", error: reply.error };
  const parsed = parseReply(reply.stdout);
  if (parsed.kind !== "draft") return parsed;
  const notes = [...(origin.notes ?? []), ...(truncated ? ["truncated"] : [])];
  try {
    return { kind: "dump", slug: parsed.slug, body: parsed.body, dump: prepareDump({ origin: { ...origin, notes }, swept: true, slug: parsed.slug, body: parsed.body, session: session.id, through: session.through }) };
  } catch (error) {
    if (error instanceof SecretRefusedError) return { kind: "secret", line: error.line, secretKind: error.kind };
    if (error instanceof BrainDumpError) return { kind: "invalid", error: `invalid draft: ${error.message}` };
    throw error;
  }
}

/** Over the cap, the head and the tail are kept. */
export function capText(text: string): { text: string; truncated: boolean } {
  if (text.length <= TEXT_CAP) return { text, truncated: false };
  const half = TEXT_CAP / 2;
  return { text: `${text.slice(0, half)}\n\n[… ${text.length - TEXT_CAP} characters left out …]\n\n${text.slice(-half)}`, truncated: true };
}

/** One tool-less, unsaved run of the pinned model, or the stub in `BRAIN_DUMP_DRAFT_AGENT`. */
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

function parseReply(stdout: string): Reply {
  const reply = stdout.trim();
  if (reply === NO_ITEMS_REPLY) return { kind: "no-items" };
  const [first = "", ...rest] = reply.split("\n");
  const slug = /^Slug:\s*(.+)$/.exec(first.trim())?.[1];
  if (slug === undefined) return { kind: "off-contract", firstLine: first.trim() };
  const body = rest.join("\n").trim().replace(/^```(?:markdown)?\n([\s\S]*)\n```$/, "$1");
  return { kind: "draft", slug, body: `${body}\n` };
}
