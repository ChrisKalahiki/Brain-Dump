import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { isRecord, parseRow, parseTime, type SessionMessage, type Transcript } from "./transcript.ts";

// Reads Codex's Session logs ("rollouts"), `~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<thread id>.jsonl`, or `.jsonl.zst` once Codex has
// compressed a cold one. Codex documents no schema for them; its
// record types live in its open-source Rust. The thread's `cwd` and branch come from its `session_meta` record, and what was said from its message events.

const ROLLOUT = /^rollout-.+\.jsonl(?:\.zst)?$/;
const ROLLOUT_EXTENSION = /\.jsonl(?:\.zst)?$/;

export function codexSessionFiles(): string[] {
  const sessions = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "sessions");
  if (!existsSync(sessions)) return [];
  return readdirSync(sessions, { recursive: true, encoding: "utf8" })
    .filter((path) => ROLLOUT.test(basename(path)))
    .map((path) => join(sessions, path));
}

/** The thread's transcript, or `undefined` for a sub-agent thread, which the Session that spawned it already covers. A rollout that won't decompress reads as empty. */
export function readCodexSession(file: string): Transcript | undefined {
  const messages: SessionMessage[] = [];
  let meta: Record<string, unknown> | undefined;
  let lastRecord: number | undefined;
  for (const line of readRollout(file).split("\n")) {
    const row = parseRow(line);
    if (row === undefined || !isRecord(row.payload)) continue;
    const at = parseTime(row.timestamp);
    if (at !== undefined) lastRecord = Math.max(lastRecord ?? at.getTime(), at.getTime());
    if (row.type === "session_meta") meta ??= row.payload;
    if (row.type !== "event_msg" || at === undefined) continue;
    const message = eventMessage(row.payload);
    if (message !== undefined && message.text !== "") messages.push({ ...message, at });
  }
  if (meta !== undefined && isSubagent(meta)) return undefined;
  const git = isRecord(meta?.git) ? meta.git : {};
  return {
    tool: "Codex",
    session: typeof meta?.id === "string" ? meta.id : basename(file).replace(ROLLOUT_EXTENSION, ""),
    file,
    cwd: typeof meta?.cwd === "string" ? meta.cwd : undefined,
    branch: typeof git.branch === "string" && git.branch !== "" ? git.branch : undefined,
    lastRecord: lastRecord === undefined ? statSync(file).mtime : new Date(lastRecord),
    messages,
    startsAfterCompaction: false,
  };
}

function readRollout(file: string): string {
  const raw = readFileSync(file);
  if (!file.endsWith(".zst")) return raw.toString("utf8");
  try {
    return Buffer.from(Bun.zstdDecompressSync(raw)).toString("utf8");
  } catch {
    return "";
  }
}

/** Codex marks a spawned thread three ways; any one is enough. */
function isSubagent(meta: Record<string, unknown>): boolean {
  return meta.thread_source === "subagent" || typeof meta.parent_thread_id === "string" || (isRecord(meta.source) && "subagent" in meta.source);
}

/**
 * A user or agent message: a `user_message` or `agent_message` event in Codex before 0.147, a completed message item since. Reasoning, commands and
 * file changes are left out, as are a compaction's `replacement_history` and the `response_item` records, which hold copies rewritten for the model.
 */
function eventMessage(payload: Record<string, unknown>): Omit<SessionMessage, "at"> | undefined {
  const { item, message } = payload;
  if (payload.type === "user_message" && typeof message === "string") return { role: "user", text: message.trim() };
  if (payload.type === "agent_message" && typeof message === "string") return { role: "assistant", text: message.trim() };
  if (payload.type !== "item_completed" || !isRecord(item)) return undefined;
  if (item.type === "UserMessage") return { role: "user", text: itemText(item.content) };
  if (item.type === "AgentMessage") return { role: "assistant", text: itemText(item.content) };
  return undefined;
}

/** The text blocks of an item's content, typed `text` for the user and `Text` for the agent. */
function itemText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => (isRecord(block) && typeof block.type === "string" && block.type.toLowerCase() === "text" && typeof block.text === "string" ? [block.text.trim()] : []))
    .filter((text) => text !== "")
    .join("\n\n");
}
