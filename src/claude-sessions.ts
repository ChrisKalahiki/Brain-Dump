import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Reads Claude Code's Session logs, `~/.claude/projects/<encoded cwd>/<session>.jsonl`. Their format is internal to Claude Code and changes between
// versions, so the reader takes only user and assistant text, timestamps, `cwd` and branch, and ignores every record it doesn't recognise.

/** Set-aside earlier copies of a transcript, which Claude Code keeps beside the live one. */
const SET_ASIDE = /\.(?:orphaned|superseded)-/;

export type SessionMessage = { role: "user" | "assistant"; text: string; at: Date };

export type Transcript = {
  session: string;
  file: string;
  cwd: string | undefined;
  branch: string | undefined;
  /** The latest timestamp of any record, or the file's modification time when no record has one. */
  lastRecord: Date;
  messages: SessionMessage[];
  /** The first record is a `compact_boundary`, so what came before it is gone from the file. */
  startsAfterCompaction: boolean;
};

/** Every top-level Session log, leaving out subagent transcripts (in per-Session subfolders, or `agent-*.jsonl` in older versions) and set-aside copies. */
export function claudeSessionFiles(): string[] {
  const projects = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
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
  let startsAfterCompaction: boolean | undefined;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const row = parseRow(line);
    if (row === undefined) continue;
    startsAfterCompaction ??= row.type === "system" && row.subtype === "compact_boundary";
    const at = typeof row.timestamp === "string" ? new Date(row.timestamp) : undefined;
    const time = at?.getTime();
    if (time !== undefined && !Number.isNaN(time)) lastRecord = Math.max(lastRecord ?? time, time);
    const role = row.type;
    if ((role !== "user" && role !== "assistant") || row.isSidechain === true || row.isMeta === true) continue;
    if (typeof row.uuid === "string") {
      if (seen.has(row.uuid)) continue;
      seen.add(row.uuid);
    }
    if (typeof row.cwd === "string") cwd = row.cwd;
    if (typeof row.gitBranch === "string" && row.gitBranch !== "") branch = row.gitBranch;
    const text = messageText(row.message);
    if (text !== "" && at !== undefined && time !== undefined && !Number.isNaN(time)) messages.push({ role, text, at });
  }
  return {
    session: file.slice(file.lastIndexOf("/") + 1, -".jsonl".length),
    file,
    cwd,
    branch,
    lastRecord: lastRecord === undefined ? statSync(file).mtime : new Date(lastRecord),
    messages,
    startsAfterCompaction: startsAfterCompaction ?? false,
  };
}

function parseRow(line: string): Record<string, unknown> | undefined {
  if (line.trim() === "") return undefined;
  try {
    const row: unknown = JSON.parse(line);
    return isRecord(row) ? row : undefined;
  } catch {
    return undefined;
  }
}

/** A message's own text: a plain string, or its text blocks; tool calls, tool results and thinking are left out. */
function messageText(message: unknown): string {
  if (!isRecord(message)) return "";
  const { content } = message;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => (isRecord(block) && block.type === "text" && typeof block.text === "string" ? [block.text.trim()] : []))
    .filter((text) => text !== "")
    .join("\n\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
