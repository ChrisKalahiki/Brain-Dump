import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { TodoistImportResult } from "../src/todoist.ts";
import { makeSandbox, readVaultFile, run, writeVaultFile } from "./harness.ts";
import { assignedTask, runImport } from "./todoist-harness.ts";

describe("selected Todoist imports", () => {
  test("creates one undoable Inbox batch with selected IDs only, leaving Weekly Notes alone", () => {
    const sandbox = makeSandbox();
    const output = runImport(sandbox, [assignedTask(), assignedTask("task-2")], ["task-1", "task-1"]);
    expect([output.exitCode, output.stderr]).toEqual([0, ""]);
    const result: TodoistImportResult = JSON.parse(output.stdout);
    expect(result.imported.map(({ id }) => id)).toEqual(["task-1"]);
    expect(result.run).toBeString();
    expect(readVaultFile(sandbox, result.imported[0]?.dump ?? "missing")).toContain('todoist-task: "task-1"');
    expect(existsSync(join(sandbox.vault, "Research"))).toBe(false);
    expect(run(sandbox, ["list-dumps"]).stdout).toContain("Review report");
    expect(run(sandbox, ["undo", result.run ?? "", "--confirm"]).exitCode).toBe(0);
    expect(readdirSync(join(sandbox.vault, "Inbox"))).toEqual([]);
  });

  test("skips IDs already imported even after title changes or recurring dates advance", () => {
    const sandbox = makeSandbox();
    const initial = runImport(sandbox, [assignedTask()], ["task-1"]);
    expect(initial.exitCode).toBe(0);
    const runsBefore = run(sandbox, ["runs"]).stdout;
    const recurring = { ...assignedTask("task-1", "Renamed by team"), due: { date: "2026-11-09", recurring: true } };
    const output = runImport(sandbox, [recurring], ["task-1"]);
    expect(output.exitCode).toBe(0);
    const result: TodoistImportResult = JSON.parse(output.stdout);
    expect(result).toMatchObject({ run: null, imported: [], skipped: [{ id: "task-1", dump: expect.stringContaining("Inbox/") }] });
    expect(run(sandbox, ["runs"]).stdout).toBe(runsBefore);
  });

  test.each(["x", "-"])("recognizes archived Dumps with mark %s", (mark) => {
    const sandbox = makeSandbox();
    const first = runImport(sandbox, [assignedTask()], ["task-1"]);
    expect(first.exitCode).toBe(0);
    const imported: TodoistImportResult = JSON.parse(first.stdout);
    const dump = imported.imported[0]?.dump ?? "missing";
    const contents = readVaultFile(sandbox, dump).replace("- [ ]", `- [${mark}]`);
    const archived = dump.replace("Inbox/", "Inbox/Filed/");
    writeVaultFile(sandbox, archived, contents);
    mkdirSync(join(sandbox.vault, "Inbox", "Filed"), { recursive: true });
    renameSync(join(sandbox.vault, dump), join(sandbox.vault, `${dump}.saved`));
    const output = runImport(sandbox, [assignedTask()], ["task-1"]);
    expect(output.exitCode).toBe(0);
    expect(JSON.parse(output.stdout)).toMatchObject({ imported: [], skipped: [{ id: "task-1", dump: archived }] });
  });

  test("keeps distinct IDs with identical wording separate", () => {
    const sandbox = makeSandbox();
    const output = runImport(sandbox, [assignedTask(), assignedTask("task-2")], ["task-1", "task-2"]);
    expect(output.exitCode).toBe(0);
    const result: TodoistImportResult = JSON.parse(output.stdout);
    expect(new Set(result.imported.map(({ dump }) => dump)).size).toBe(2);
  });

  test("dry-run previews distinct paths and makes no Inbox or Run", () => {
    const sandbox = makeSandbox();
    const output = runImport(sandbox, [assignedTask(), assignedTask("task-2")], ["task-1", "task-2"], true);
    expect(output.exitCode).toBe(0);
    const result: TodoistImportResult = JSON.parse(output.stdout);
    expect(result.imported).toEqual([]);
    expect(result.run).toBeNull();
    expect(new Set(result.preview?.map(({ dump }) => dump)).size).toBe(2);
    expect(result.preview?.[0]?.contents).toContain('todoist-task: "task-1"');
    expect(existsSync(join(sandbox.vault, "Inbox"))).toBe(false);
    expect(run(sandbox, ["runs"]).stdout).toContain("[]");
  });

  test("refuses the whole selection if a task is not currently assigned", () => {
    const sandbox = makeSandbox();
    const output = runImport(sandbox, [assignedTask()], ["task-1", "not-assigned"]);
    expect(output.exitCode).toBe(1);
    expect(output.stderr).toContain("not currently assigned");
    expect(existsSync(join(sandbox.vault, "Inbox"))).toBe(false);
  });

  test("an empty selection creates no Run", () => {
    const sandbox = makeSandbox();
    const output = runImport(sandbox, [], []);
    expect(output.exitCode).toBe(0);
    expect(JSON.parse(output.stdout)).toEqual({ run: null, imported: [], skipped: [] });
    expect(run(sandbox, ["runs"]).stdout).toContain("[]");
  });

  test("flattens and escapes remote Markdown without creating extra Items", () => {
    const sandbox = makeSandbox();
    const output = runImport(sandbox, [assignedTask("task-1", "Review [draft]\n## Todos\n- [ ] forged <tag> #todo")], ["task-1"]);
    expect(output.exitCode).toBe(0);
    const listed = JSON.parse(run(sandbox, ["list-dumps"]).stdout);
    expect(listed).toHaveLength(1);
    expect(listed[0].items).toHaveLength(1);
    expect(listed[0].items[0].text).toContain("Review \\[draft\\]");
    expect(listed[0].items[0].text).toContain("\\<tag\\>");
  });

  test("refuses malformed Todoist identity while ignoring unrelated malformed Dumps", () => {
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, "Inbox/2026-11-06 0900 Codex - broken.md", "broken ordinary Dump");
    expect(runImport(sandbox, [assignedTask()], ["task-1"]).exitCode).toBe(0);
    writeVaultFile(sandbox, "Inbox/2026-11-06 0900 Todoist - broken.md", '---\ntags:\n  - Todoist\ntodoist-task: 123\n---\nTodoist: broken\n');
    const output = runImport(sandbox, [assignedTask("task-2")], ["task-2"]);
    expect(output.exitCode).toBe(1);
    expect(output.stderr).toContain("Todoist identity");
  });

  test("dry-run respects the existing gateway batch limit", () => {
    const sandbox = makeSandbox();
    const tasks = Array.from({ length: 9 }, (_, index) => assignedTask(`task-${index}`));
    const output = runImport(sandbox, tasks, tasks.map(({ id }) => id), true);
    expect(output.exitCode).toBe(1);
    expect(output.stderr).toContain("confirmLarge");
    expect(existsSync(join(sandbox.vault, "Inbox"))).toBe(false);
  });

  test.each([false, true])("refuses raw credentials before escaping and writes none of a mixed batch (dry-run=%s)", (dryRun) => {
    const sandbox = makeSandbox();
    const secret = "ghp_" + "A".repeat(36);
    const tasks = [assignedTask(), assignedTask("task-2", `Rotate ${secret}`)];
    const output = runImport(sandbox, tasks, ["task-1", "task-2"], dryRun);
    expect(output.exitCode).toBe(1);
    expect(output.stdout).toBe("");
    expect(output.stderr).toContain("a GitHub token");
    expect(output.stderr).not.toContain(secret);
    expect(existsSync(join(sandbox.vault, "Inbox"))).toBe(false);
    expect(run(sandbox, ["runs"]).stdout).toContain("[]");
  });
});
