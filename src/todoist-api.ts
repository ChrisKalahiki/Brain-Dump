import { BrainDumpError, UsageError } from "./errors.ts";
import { isTodoistId, todoistTaskUrl } from "./todoist-origin.ts";

export type TodoistTask = {
  id: string;
  content: string;
  projectId: string;
  due: { date: string; recurring: boolean } | null;
  url: string;
};

type TodoistRequest = (url: URL, init: RequestInit) => Promise<Response>;

export async function readAssignedTodoistTasks(token: string, request: TodoistRequest = fetch): Promise<TodoistTask[]> {
  if (token.trim() === "" || /[\r\n]/.test(token)) throw new UsageError("set TODOIST_API_TOKEN before reading Todoist");
  const tasks = new Map<string, TodoistTask>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const url = new URL("https://api.todoist.com/api/v1/tasks/filter");
    url.searchParams.set("query", "assigned to: me");
    url.searchParams.set("limit", "200");
    if (cursor !== null) {
      if (cursors.has(cursor)) throw new BrainDumpError("invalid Todoist response: repeated cursor");
      cursors.add(cursor);
      url.searchParams.set("cursor", cursor);
    }
    let response: Response;
    try {
      response = await request(url, { method: "GET", headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(10_000) });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new BrainDumpError(`Todoist request failed: ${timedOut ? "timed out" : "unreachable"}`);
    }
    if (!response.ok) throw new BrainDumpError(`Todoist request failed (HTTP ${response.status})`);
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new BrainDumpError("invalid Todoist response");
    }
    if (!isRecord(value) || !Array.isArray(value.results) || (value.next_cursor !== null && (typeof value.next_cursor !== "string" || value.next_cursor === ""))) invalid();
    for (const raw of value.results) {
      const task = readTask(raw);
      if (!tasks.has(task.id)) tasks.set(task.id, task);
    }
    cursor = value.next_cursor;
  } while (cursor !== null);
  return [...tasks.values()];
}
function readTask(value: unknown): TodoistTask {
  if (!isRecord(value) || !isTodoistId(value.id) || !isTodoistId(value.project_id) || typeof value.content !== "string" || value.content.trim() === "") invalid();
  let due: TodoistTask["due"] = null;
  if (value.due !== null) {
    if (!isRecord(value.due) || typeof value.due.date !== "string" || value.due.date === "" || typeof value.due.is_recurring !== "boolean") invalid();
    due = { date: value.due.date, recurring: value.due.is_recurring };
  }
  return { id: value.id, content: value.content, projectId: value.project_id, due, url: todoistTaskUrl(value.id) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(): never {
  throw new BrainDumpError("invalid Todoist response");
}
