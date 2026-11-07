import { describe, expect, test } from "bun:test";
import { parseDump, prepareDump } from "../src/dump.ts";
import type { TodoistOrigin } from "../src/origin.ts";

const origin: TodoistOrigin = {
  kind: "todoist", tool: "Todoist", task: "000123/a", remoteProject: "000456",
  project: undefined, at: new Date(2026, 10, 6, 10, 30),
};
const request = { origin, slug: "review report", body: "## Todos\n- [ ] Review the report. #todo\n" };

describe("a Todoist Dump's origin", () => {
  test("round-trips opaque IDs, remote project and import time without inventing a vault Project", () => {
    const dump = prepareDump(request);
    expect(dump.stem).toBe("2026-11-06 1030 Todoist - review report");
    expect(dump.contents).toContain('todoist-task: "000123/a"');
    expect(dump.contents).toContain('todoist-project: "000456"');
    expect(dump.contents).toContain("Todoist: https://app.todoist.com/app/task/000123%2Fa · 2026-11-06 10:30");
    expect(parseDump(`${dump.stem}.md`, dump.contents)).toMatchObject({ origin, swept: false, session: undefined, label: "Todoist" });
  });

  test.each(["", " ", "task\nforged", "task\u0000"])("refuses an invalid task ID %j", (task) => {
    expect(() => prepareDump({ ...request, origin: { ...origin, task } })).toThrow("Todoist task ID");
  });

  test("refuses invalid remote project IDs and Session coverage", () => {
    expect(() => prepareDump({ ...request, origin: { ...origin, remoteProject: "" } })).toThrow("Todoist project ID");
    expect(() => prepareDump({ ...request, session: "session-1" })).toThrow("Todoist");
  });

  test("rejects a source link that disagrees with the stored task ID", () => {
    const dump = prepareDump(request);
    const contents = dump.contents.replace("/task/000123%2Fa", "/task/different");
    expect(parseDump(`${dump.stem}.md`, contents)).toMatchObject({ problem: expect.stringContaining("Todoist") });
  });

  test("rejects missing or non-string identity metadata", () => {
    const dump = prepareDump(request);
    for (const text of [dump.contents.replace('todoist-task: "000123/a"\n', ""), dump.contents.replace('todoist-task: "000123/a"', "todoist-task: 123")]) {
      expect(parseDump(`${dump.stem}.md`, text)).toHaveProperty("problem");
    }
  });

  test("encodes link delimiters inside opaque IDs", () => {
    const dump = prepareDump({ ...request, origin: { ...origin, task: "a)b[c]" } });
    expect(dump.contents).toContain("https://app.todoist.com/app/task/a%29b%5Bc%5D");
    expect(parseDump(`${dump.stem}.md`, dump.contents)).toMatchObject({ origin: { task: "a)b[c]" } });
  });
});
