import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

export type Sandbox = {
  home: string;
  vault: string;
};

export function makeSandbox(): Sandbox {
  const home = mkdtempSync(join(tmpdir(), "brain-dump-test-"));
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
  options: { stdin?: string; cwd?: string } = {},
): RunResult {
  const result = Bun.spawnSync(["bun", CLI, ...args], {
    cwd: options.cwd ?? sandbox.home,
    env: { PATH: process.env.PATH, HOME: sandbox.home, TZ: "UTC" },
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
