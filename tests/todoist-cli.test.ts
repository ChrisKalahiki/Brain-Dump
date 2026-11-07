import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { makeSandbox, readVaultFile, run } from "./harness.ts";
import type { TodoistImportResult } from "../src/todoist.ts";

function todoist(args: readonly string[], home: string, token?: string) {
  const result = Bun.spawnSync(["bun", "--preload", join(import.meta.dir, "fixtures", "todoist-fetch.ts"), join(import.meta.dir, "..", "src", "cli.ts"), "todoist", ...args], {
    env: { PATH: process.env.PATH, HOME: home, TZ: "UTC", BRAIN_DUMP_NOW: "2026-11-06T10:30:00Z", ...(token === undefined ? {} : { TODOIST_API_TOKEN: token }) },
  });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

describe("brain-dump todoist", () => {
  test("lists assigned tasks without requiring a vault", () => {
    const sandbox = makeSandbox();
    const output = todoist(["list"], join(sandbox.home, "no-vault"), "synthetic-token");
    expect([output.exitCode, output.stderr]).toEqual([0, ""]);
    expect(JSON.parse(output.stdout).tasks.map(({ id }: { id: string }) => id)).toEqual(["task-1", "task-2"]);
    expect(existsSync(join(sandbox.home, "no-vault"))).toBe(false);
  });

  test("imports repeated task flags and supports a dry-run followed by approved Filing", () => {
    const sandbox = makeSandbox();
    const args = ["import", "--task", "task-1", "--task", "task-2"];
    const preview = todoist([...args, "--dry-run"], sandbox.home, "synthetic-token");
    expect(preview.exitCode).toBe(0);
    expect(JSON.parse(preview.stdout).preview).toHaveLength(2);
    expect(existsSync(join(sandbox.vault, "Inbox"))).toBe(false);
    const imported = todoist(args, sandbox.home, "synthetic-token");
    expect([imported.exitCode, imported.stderr]).toEqual([0, ""]);
    const result: TodoistImportResult = JSON.parse(imported.stdout);
    expect(result.imported.map(({ id }) => id)).toEqual(["task-1", "task-2"]);
    expect(readVaultFile(sandbox, result.imported[0]?.dump ?? "missing")).toContain("Todoist: https://app.todoist.com/app/task/task-1");
    const list = run(sandbox, ["list-dumps"]);
    expect(list.exitCode).toBe(0);
    expect(JSON.parse(list.stdout)).toHaveLength(2);
  });

  test.each([
    { args: [], message: "todoist needs list or import" },
    { args: ["wrong"], message: "todoist needs list or import" },
    { args: ["list", "--task", "task-1"], message: "--task" },
    { args: ["import"], message: "needs at least one valid --task" },
    { args: ["import", "--task", ""], message: "needs at least one valid --task" },
  ])("rejects invalid usage before reading the account: %j", ({ args, message }) => {
    const sandbox = makeSandbox();
    const output = todoist(args, sandbox.home);
    expect(output.exitCode).toBe(2);
    expect(output.stdout).toBe("");
    expect(output.stderr).not.toContain("TODOIST_API_TOKEN");
    expect(output.stderr).toContain(message);
    expect(existsSync(join(sandbox.vault, "Inbox"))).toBe(false);
  });

  test("requires credentials without writing the vault", () => {
    const sandbox = makeSandbox();
    const output = todoist(["import", "--task", "task-1"], sandbox.home);
    expect(output.exitCode).toBe(2);
    expect(output.stderr).toContain("TODOIST_API_TOKEN");
    expect(existsSync(join(sandbox.vault, "Inbox"))).toBe(false);
  });

  test("offers help without credentials or a vault", () => {
    const sandbox = makeSandbox();
    const output = todoist(["--help"], join(sandbox.home, "no-vault"));
    expect(output.exitCode).toBe(0);
    expect(output.stdout).toContain("todoist import --task");
  });
});
