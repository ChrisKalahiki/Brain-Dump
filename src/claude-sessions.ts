import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { isRecord, parseRow, parseTime, type SessionMessage, type Transcript } from "./transcript.ts";

// Reads Claude Code's Session logs, `~/.claude/projects/<encoded cwd>/<session>.jsonl`. Their format is internal to Claude Code and changes between versions.

/** Set-aside earlier copies of a transcript, which Claude Code keeps beside the live one. */
const SET_ASIDE = /\.(?:orphaned|superseded)-/;

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
