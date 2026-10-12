import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { contentHash } from "../src/content-hash.ts";
import { ROUTES_NOTE } from "../src/layout.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

export type Sandbox = {
  home: string;
  vault: string;
};

export function makeSandbox(): Sandbox {
  // Resolved, so HOME matches the paths git reports where the temp folder sits behind a symlink, as /var does on macOS.
  const home = realpathSync(mkdtempSync(join(tmpdir(), "brain-dump-test-")));
  const vault = join(home, "Documents", "The Vault");
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  return { home, vault };
}

export function writeConfig(sandbox: Sandbox, contents: string): void {
  const dir = join(sandbox.home, ".config", "brain-dump");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config"), contents);
}

export type RunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export function run(
  sandbox: Sandbox,
  args: string[],
  options: { stdin?: string; cwd?: string; throughPipe?: boolean; now?: string; env?: Record<string, string> } = {},
): RunResult {
  const command = options.throughPipe
    ? ["sh", "-c", 'bun "$0" "$@" | cat', CLI, ...args]
    : ["bun", CLI, ...args];
  const result = Bun.spawnSync(command, {
    cwd: options.cwd ?? sandbox.home,
    env: { PATH: process.env.PATH, HOME: sandbox.home, TZ: "UTC", ...(options.now === undefined ? {} : { BRAIN_DUMP_NOW: options.now }), ...options.env },
    stdin: options.stdin === undefined ? "ignore" : Buffer.from(options.stdin),
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

export function makeRepo(sandbox: Sandbox, name: string, branch: string): string {
  const repo = join(sandbox.home, "Projects", name);
  mkdirSync(repo, { recursive: true });
  Bun.spawnSync(["git", "init", "--quiet", "--initial-branch", branch], { cwd: repo });
  return repo;
}

export const DUMP_AT = "2026-10-05T19:40";

export function writeDumpArgs(slug = "s", tool = "ClaudeCode"): string[] {
  return ["write-dump", "--tool", tool, "--slug", slug, "--at", DUMP_AT];
}

export function originLine(dumpPath: string): string | undefined {
  return readFileSync(dumpPath, "utf8")
    .split("\n")
    .find((line) => line.startsWith("Session: "));
}

export function writeVaultFile(sandbox: Sandbox, relativePath: string, contents: string): string {
  const path = join(sandbox.vault, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  return path;
}

export function readVaultFile(sandbox: Sandbox, relativePath: string): string {
  return readFileSync(join(sandbox.vault, relativePath), "utf8");
}

export function dumpFile(origin: string, body: string, tool = "ClaudeCode"): string {
  return `---\ntags:\n  - dump\n  - AIGenerated\n  - ${tool}\n---\n${origin}\n\n${body}`;
}

export const WEEKLY_TEMPLATE = `---
tags:
  - weeklyupdate
  - research
---

![[Clemson_Tigers_logo.png|200]]
# Updates:
- 
---
# To-Do: #todo 
- [ ] 

---
# Blockers
- [ ] 

---
# Notes:
- 

---
# Key Takeaways
- 
`;

export const DEV_ORIGIN = "Session: Claude Code · `~/Projects/Brain-Dump` @ `main` · 2026-10-05 19:40 · [[Brain-Dump]]";

export { ROUTES_NOTE };

export function vaultFileHash(sandbox: Sandbox, relativePath: string): string {
  return contentHash(readFileSync(join(sandbox.vault, relativePath)));
}

/** Adds `expect`, pinning the Dump, every note the plan names and the Routes note to their hashes on disk now, as the file skill does from its reads. A plan that already has `expect`, or isn't an object, is left as it is. */
export function pinned(sandbox: Sandbox, plan: unknown): unknown {
  if (!isRecord(plan) || "expect" in plan) return plan;
  const noted = [plan.items, plan.inserts].flatMap((list) => (Array.isArray(list) ? list.map((entry) => (isRecord(entry) ? entry.note : undefined)) : []));
  const existing = [plan.dump, ROUTES_NOTE, ...noted].filter((note): note is string => typeof note === "string" && existsSync(join(sandbox.vault, note)));
  return { ...plan, expect: Object.fromEntries(existing.map((note) => [note, vaultFileHash(sandbox, note)])) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
