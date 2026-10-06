import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { makeSandbox, run, writeConfig } from "./harness.ts";

describe("brain-dump vault", () => {
  test("finds the Vault at ~/Documents/The Vault by default", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = run(sandbox, ["vault"]);

    // #then
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(sandbox.vault);
  });

  test("uses the Vault path from the per-machine config when set", () => {
    // #given
    const sandbox = makeSandbox();
    const elsewhere = join(sandbox.home, "Sync", "Notes");
    mkdirSync(join(elsewhere, ".obsidian"), { recursive: true });
    writeConfig(sandbox, "vault = ~/Sync/Notes\n");

    // #when
    const result = run(sandbox, ["vault"]);

    // #then
    expect(result.stdout.trim()).toBe(elsewhere);
  });

  test("refuses a folder that is not an Obsidian Vault", () => {
    // #given
    const sandbox = makeSandbox();
    rmSync(join(sandbox.vault, ".obsidian"), { recursive: true });

    // #when
    const result = run(sandbox, ["vault"]);

    // #then
    expect([result.exitCode, result.stderr]).toEqual([
      1,
      `brain-dump: ${sandbox.vault} is not an Obsidian Vault (no .obsidian/)\n`,
    ]);
  });

  test("refuses a Vault path that does not exist", () => {
    // #given
    const sandbox = makeSandbox();
    writeConfig(sandbox, "vault = ~/Nowhere\n");

    // #when
    const result = run(sandbox, ["vault"]);

    // #then
    expect([result.exitCode, result.stderr]).toEqual([
      1,
      `brain-dump: Vault not found at ${join(sandbox.home, "Nowhere")}\n`,
    ]);
  });

  test("creates the Inbox when it is missing", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    run(sandbox, ["vault"]);

    // #then
    expect(existsSync(join(sandbox.vault, "Inbox"))).toBe(true);
  });
});
