import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { isRecord, parseRow, parseTime, textBlocks, type SessionMessage, type Transcript } from "./transcript.ts";

// Reads and writes Claude Code's Session logs, `~/.claude/projects/<encoded cwd>/<session>.jsonl`. Their format is internal to Claude Code and changes
// between versions; `compact_boundary` marks a compaction. Tests and evals write logs only through `renderClaudeSession`, so they can't drift from the reader.

/** Set-aside earlier copies of a transcript, which Claude Code keeps beside the live one. */
const SET_ASIDE = /\.(?:orphaned|superseded)-/;

/** What a Claude Code log holds of a Session, as `readClaudeSession` reads it back. */
export type ClaudeSessionLog = { session: string; cwd: string; branch?: string; messages: SessionMessage[]; startsAfterCompaction?: boolean };

/** Claude Code's config folder: `CLAUDE_CONFIG_DIR`, else `~/.claude`. */
function claudeConfigFolder(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
}

/** Where Claude Code keeps the logs of Sessions run in `cwd`: a folder named for it, every character but letters and digits made a dash. */
export function claudeProjectFolder(cwd: string, config = claudeConfigFolder()): string {
  return join(config, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
}

/** Every top-level Session log, leaving out subagent transcripts (in per-Session subfolders, or `agent-*.jsonl` in older versions) and set-aside copies. */
export function claudeSessionFiles(): string[] {
  const projects = join(claudeConfigFolder(), "projects");
  if (!existsSync(projects)) return [];
  return readdirSync(projects, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) =>
      readdirSync(join(projects, entry.name), { withFileTypes: true })
        .filter((file) => file.isFile() && file.name.endsWith(".jsonl") && !file.name.startsWith("agent-") && !SET_ASIDE.test(file.name))
        .map((file) => join(projects, entry.name, file.name)),
    );
}

export function readClaudeSession(file: string): Transcript {
  const seen = new Set<string>();
  const messages: SessionMessage[] = [];
  let cwd: string | undefined;
  let branch: string | undefined;
  let lastRecord: number | undefined;
  let startsAfterCompaction = false;
  let sawMessage = false;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const row = parseRow(line);
    if (row === undefined) continue;
    if (!sawMessage && row.type === "system" && row.subtype === "compact_boundary") startsAfterCompaction = true;
    const at = parseTime(row.timestamp);
    if (at !== undefined) lastRecord = Math.max(lastRecord ?? at.getTime(), at.getTime());
    if (typeof row.cwd === "string") cwd = row.cwd;
    if (typeof row.gitBranch === "string" && row.gitBranch !== "") branch = row.gitBranch;
    const role = row.type;
    if ((role !== "user" && role !== "assistant") || row.isSidechain === true || row.isMeta === true) continue;
    sawMessage = true;
    if (typeof row.uuid === "string") {
      if (seen.has(row.uuid)) continue;
      seen.add(row.uuid);
    }
    const text = messageText(row.message);
    if (text !== "" && at !== undefined) messages.push({ role, text, at });
  }
  return {
    tool: "ClaudeCode",
    session: basename(file, ".jsonl"),
    file,
    cwd,
    branch,
    lastRecord: lastRecord === undefined ? statSync(file).mtime : new Date(lastRecord),
    messages,
    startsAfterCompaction,
  };
}

/** The log as Claude Code writes it: one record per message, chained by uuid, after a compaction boundary when `startsAfterCompaction`. */
export function renderClaudeSession({ session, cwd, branch, messages, startsAfterCompaction = false }: ClaudeSessionLog): string {
  const common = { isSidechain: false, userType: "external", cwd, sessionId: session, gitBranch: branch ?? "" };
  const rows: Record<string, unknown>[] = [];
  if (startsAfterCompaction) {
    const boundary = { type: "system", subtype: "compact_boundary", content: "Conversation compacted", isMeta: false, level: "info", compactMetadata: { trigger: "auto" } };
    rows.push({ parentUuid: null, ...common, ...boundary, uuid: crypto.randomUUID(), timestamp: messages[0]?.at.toISOString() });
  }
  for (const [index, { role, text, at }] of messages.entries()) {
    const message =
      role === "user"
        ? { role, content: text }
        : { id: `msg_fixture_${index}`, type: "message", role, model: "<synthetic>", content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null };
    rows.push({ parentUuid: rows.at(-1)?.uuid ?? null, ...common, type: role, message, uuid: crypto.randomUUID(), timestamp: at.toISOString() });
  }
  return rows.map((row) => `${JSON.stringify(row)}\n`).join("");
}

/** A message's own text: a plain string, or its text blocks. */
function messageText(message: unknown): string {
  if (!isRecord(message)) return "";
  return typeof message.content === "string" ? message.content.trim() : textBlocks(message.content);
}
