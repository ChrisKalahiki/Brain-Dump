import type { DevToolTag } from "./origin.ts";

// What the Sweep's readers make of a Session log, one reader per tool. Neither tool's log format is a stable interface, so each reader takes only user and
// assistant text, timestamps, `cwd` and branch, and ignores every record it doesn't recognise.

export type SessionMessage = { role: "user" | "assistant"; text: string; at: Date };

export type Transcript = {
  tool: DevToolTag;
  session: string;
  file: string;
  cwd: string | undefined;
  branch: string | undefined;
  /** The latest timestamp of any record, or the file's modification time when no record has one. */
  lastRecord: Date;
  messages: SessionMessage[];
  /** The log was cut at a compaction before its first message, so what came before is gone from the file. */
  startsAfterCompaction: boolean;
};

export function parseTime(timestamp: unknown): Date | undefined {
  const at = typeof timestamp === "string" ? new Date(timestamp) : undefined;
  return at === undefined || Number.isNaN(at.getTime()) ? undefined : at;
}

export function parseRow(line: string): Record<string, unknown> | undefined {
  if (line.trim() === "") return undefined;
  try {
    const row: unknown = JSON.parse(line);
    return isRecord(row) ? row : undefined;
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The trimmed, non-empty text of a message's content blocks whose type is `text` in any case; tool calls, tool results and thinking are left out. */
export function textBlocks(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => (isRecord(block) && typeof block.type === "string" && block.type.toLowerCase() === "text" && typeof block.text === "string" ? [block.text.trim()] : []))
    .filter((text) => text !== "")
    .join("\n\n");
}
