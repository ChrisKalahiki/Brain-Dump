import { describe, expect, spyOn, test } from "bun:test";
import { readAssignedTodoistTasks } from "../src/todoist-api.ts";

const task = { id: "000123", content: "Review report", project_id: "project-1", responsible_uid: "me", due: null };
const page = (results: unknown[], next_cursor: string | null = null) => Response.json({ results, next_cursor });

describe("reading assigned Todoist tasks", () => {
  test("uses the assigned-to-me filter and paginates without changing its query", async () => {
    const requests: { url: string; method: string | undefined; auth: string | null; redirect: string | undefined }[] = [];
    const tasks = await readAssignedTodoistTasks("synthetic-token", async (url, init) => {
      requests.push({ url: url.toString(), method: init.method, auth: new Headers(init.headers).get("Authorization"), redirect: init.redirect });
      return url.searchParams.has("cursor")
        ? page([{ ...task, id: "opaque/a", due: { date: "2026-11-07", is_recurring: true, string: "every day", lang: "en" } }])
        : page([task], "page/2");
    });
    expect(requests).toEqual([
      { url: "https://api.todoist.com/api/v1/tasks/filter?query=assigned+to%3A+me&limit=200", method: "GET", auth: "Bearer synthetic-token", redirect: "error" },
      { url: "https://api.todoist.com/api/v1/tasks/filter?query=assigned+to%3A+me&limit=200&cursor=page%2F2", method: "GET", auth: "Bearer synthetic-token", redirect: "error" },
    ]);
    expect(tasks).toEqual([
      { id: "000123", content: "Review report", projectId: "project-1", due: null, url: "https://app.todoist.com/app/task/000123" },
      { id: "opaque/a", content: "Review report", projectId: "project-1", due: { date: "2026-11-07", recurring: true }, url: "https://app.todoist.com/app/task/opaque%2Fa" },
    ]);
  });

  test("deduplicates IDs repeated between pages", async () => {
    const tasks = await readAssignedTodoistTasks("synthetic", async (url) => url.searchParams.has("cursor") ? page([task]) : page([task], "next"));
    expect(tasks.map(({ id }) => id)).toEqual(["000123"]);
  });

  test.each([
    {}, { results: [], next_cursor: 12 }, { results: [null], next_cursor: null },
    { results: [{ ...task, id: 123 }], next_cursor: null },
    { results: [{ ...task, project_id: "" }], next_cursor: null },
    { results: [{ ...task, content: " " }], next_cursor: null },
    { results: [{ ...task, due: { date: "2026-11-07" } }], next_cursor: null },
  ])("rejects malformed pages instead of returning a partial result: %j", async (value) => {
    await expect(readAssignedTodoistTasks("synthetic", async () => Response.json(value))).rejects.toThrow("invalid Todoist response");
  });

  test.each([401, 403, 429, 500])("reports HTTP %i without exposing credentials or server bodies", async (status) => {
    await expect(readAssignedTodoistTasks("synthetic-secret", async () => new Response("synthetic-secret: private server detail", { status })))
      .rejects.toThrow(`Todoist request failed (HTTP ${status})`);
  });

  test("rejects a failed later page and repeated pagination cursor", async () => {
    await expect(readAssignedTodoistTasks("synthetic", async (url) => url.searchParams.has("cursor") ? new Response("bad", { status: 500 }) : page([task], "next")))
      .rejects.toThrow("HTTP 500");
    await expect(readAssignedTodoistTasks("synthetic", async () => page([task], "next"))).rejects.toThrow("repeated cursor");
  });

  test("sanitizes malformed JSON and network errors", async () => {
    await expect(readAssignedTodoistTasks("synthetic-secret", async () => new Response("not json: synthetic-secret"))).rejects.toThrow("invalid Todoist response");
    await expect(readAssignedTodoistTasks("synthetic-secret", async () => { throw new Error("synthetic-secret: transport detail"); })).rejects.toThrow(/^Todoist request failed: unreachable$/);
  });

  test("uses a ten-second abort signal and reports a timeout", async () => {
    const timeout = spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort(new DOMException("private detail", "TimeoutError")));
    try {
      await expect(readAssignedTodoistTasks("synthetic", async (_url, init) => { init.signal?.throwIfAborted(); return page([]); })).rejects.toThrow("timed out");
      expect(timeout).toHaveBeenCalledWith(10_000);
    } finally {
      timeout.mockRestore();
    }
  });

  test("requires a token before making a request", async () => {
    let called = false;
    await expect(readAssignedTodoistTasks(" ", async () => { called = true; return page([]); })).rejects.toThrow("TODOIST_API_TOKEN");
    expect(called).toBe(false);
  });
});
