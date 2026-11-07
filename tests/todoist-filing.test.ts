import { describe, expect, test } from "bun:test";
import type { TodoistOrigin } from "../src/origin.ts";
import { dumpFile, makeSandbox, pinned, readVaultFile, run, WEEKLY_TEMPLATE, writeVaultFile } from "./harness.ts";
import { assignedTask, runImport } from "./todoist-harness.ts";

const DUMP = "Inbox/2026-11-06 1030 Todoist - review report.md";
const WEEK = "Research/Weekly Meetings/11-02-26 Weekly Update.md";
const LINK = "[Todoist](https://app.todoist.com/app/task/task-1)";
const origin: TodoistOrigin = { kind: "todoist", tool: "Todoist", task: "task-1", remoteProject: "team-project", project: undefined, at: new Date("2026-11-06T10:30:00Z") };

describe("Filing Todoist snapshots", () => {
  test.each(["Personal wording", `Personal wording ${LINK}`])("retains one source link after an approved edit: %s", (text) => {
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(origin, "## Todos\n- [ ] Original team wording #todo\n"));
    writeVaultFile(sandbox, WEEK, WEEKLY_TEMPLATE);
    const plan = pinned(sandbox, { dump: DUMP, items: [{ index: 1, outcome: "filed", note: WEEK, section: "# To-Do:", text }] });
    const applied = run(sandbox, ["apply"], { stdin: JSON.stringify(plan) });
    expect([applied.exitCode, applied.stderr]).toEqual([0, ""]);
    expect(readVaultFile(sandbox, WEEK)).toContain(`- [ ] Personal wording ${LINK} #todo`);
    const todos = JSON.parse(run(sandbox, ["todos", "--date", "2026-11-06"]).stdout);
    expect(todos.todos).toHaveLength(1);
    expect(todos.todos[0]).toMatchObject({ text: `Personal wording ${LINK}`, state: "open", parentIndex: null });
    expect(readVaultFile(sandbox, DUMP.replace("Inbox/", "Inbox/Filed/"))).toContain('todoist-task: "task-1"');
    const again = runImport(sandbox, [assignedTask("task-1", "Renamed upstream")], ["task-1"]);
    expect(again.exitCode).toBe(0);
    expect(JSON.parse(again.stdout)).toMatchObject({ run: null, imported: [] });
  });

  test("keeps existing stale-plan protection", () => {
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(origin, "## Todos\n- [ ] Original #todo\n"));
    writeVaultFile(sandbox, WEEK, WEEKLY_TEMPLATE);
    const plan = pinned(sandbox, { dump: DUMP, items: [{ index: 1, outcome: "filed", note: WEEK, section: "# To-Do:" }] });
    writeVaultFile(sandbox, WEEK, `${WEEKLY_TEMPLATE}\nPersonal edit\n`);
    const result = run(sandbox, ["apply"], { stdin: JSON.stringify(plan) });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Filing Plan stale");
    expect(readVaultFile(sandbox, WEEK)).not.toContain(LINK);
  });
});
