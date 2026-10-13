import { datePart, pad } from "./clock.ts";
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

// The Session text form: each message under a `[YYYY-MM-DD HH:MM] User:` or `Assistant:` header, in local time. The Sweep hands the drafting agent a
// Session in this form, and eval fixtures are written in it.

const TEXT_HEADER = /^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})\] (User|Assistant):$/;

export function renderSessionText(messages: SessionMessage[]): string {
  return messages.map(({ role, text, at }) => `[${datePart(at)} ${pad(at.getHours())}:${pad(at.getMinutes())}] ${role === "user" ? "User" : "Assistant"}:\n${text}`).join("\n\n");
}

/** Times are to the minute, so only a message at a whole minute reads back exactly. */
export function parseSessionText(text: string): SessionMessage[] {
  const messages: SessionMessage[] = [];
  for (const line of text.split("\n")) {
    const header = TEXT_HEADER.exec(line);
    const last = messages.at(-1);
    if (header !== null) {
      const [year, month, day, hour, minute] = header.slice(1, 6).map(Number);
      messages.push({ role: header[6] === "User" ? "user" : "assistant", text: "", at: new Date(year ?? 0, (month ?? 1) - 1, day, hour, minute) });
    } else if (last !== undefined) {
      last.text += `${line}\n`;
    }
  }
  return messages.map((message) => ({ ...message, text: message.text.trim() }));
}
