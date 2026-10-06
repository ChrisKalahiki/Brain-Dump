import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { makeRepo, makeSandbox, run, writeConfig, writeDumpArgs } from "./harness.ts";

const BODY = `## Learnings
- [ ] Codex reads skills from ~/.agents/skills.

## Decisions
- [ ] Filing is append-only in v1.
\t- Why: protect curated notes from accidental overwrite.

## Todos
- [ ] #todo Decide skill packaging.
`;

describe("brain-dump write-dump", () => {
  test("writes a Dump from a git repo into the Inbox and prints its path", () => {
    // #given
    const sandbox = makeSandbox();
    const repo = makeRepo(sandbox, "Brain-Dump", "main");

    // #when
    const result = run(
      sandbox,
      writeDumpArgs("wayfinder charting"),
      { stdin: BODY, cwd: repo },
    );

    // #then
    const path = join(sandbox.vault, "Inbox", "2026-10-05 1940 Brain-Dump - wayfinder charting.md");
    expect([result.exitCode, result.stdout, readFileSync(path, "utf8")]).toEqual([
      0,
      `${path}\n`,
      `---
tags:
  - dump
  - AIGenerated
  - ClaudeCode
---
Session: Claude Code · \`~/Projects/Brain-Dump\` @ \`main\` · 2026-10-05 19:40 · [[Brain-Dump]]

${BODY}`,
    ]);
  });

  test("outside a git repo, uses the directory name and leaves out the branch", () => {
    // #given
    const sandbox = makeSandbox();
    const scratch = join(sandbox.home, "scratch");
    mkdirSync(scratch);

    // #when
    const result = run(sandbox, ["write-dump", "--tool", "Codex", "--slug", "notes", "--at", "2026-10-05T08:05"], {
      stdin: BODY,
      cwd: scratch,
    });

    // #then
    expect(readFileSync(result.stdout.trim(), "utf8").split("\n")[6]).toBe(
      "Session: Codex · `~/scratch` · 2026-10-05 08:05 · [[scratch]]",
    );
  });

  test("adds -2 then -3 when a Dump with the same name already exists", () => {
    // #given
    const sandbox = makeSandbox();
    const repo = makeRepo(sandbox, "Brain-Dump", "main");
    const args = writeDumpArgs("same");

    // #when
    const paths = [1, 2, 3].map(() => run(sandbox, args, { stdin: BODY, cwd: repo }).stdout.trim());

    // #then
    const inbox = join(sandbox.vault, "Inbox");
    expect(paths).toEqual([
      join(inbox, "2026-10-05 1940 Brain-Dump - same.md"),
      join(inbox, "2026-10-05 1940 Brain-Dump - same-2.md"),
      join(inbox, "2026-10-05 1940 Brain-Dump - same-3.md"),
    ]);
  });

  test("replaces characters Obsidian forbids in filenames", () => {
    // #given
    const sandbox = makeSandbox();
    const repo = makeRepo(sandbox, "Brain-Dump", "main");

    // #when
    run(sandbox, writeDumpArgs('auth: OAuth/PKCE [draft] #2 "why?"'), {
      stdin: BODY,
      cwd: repo,
    });

    // #then
    expect(readdirSync(join(sandbox.vault, "Inbox"))).toEqual(["2026-10-05 1940 Brain-Dump - auth OAuth PKCE draft 2 why.md"]);
  });

  test("rejects an --at value that is not a date and time", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = run(sandbox, ["write-dump", "--tool", "ClaudeCode", "--slug", "s", "--at", "yesterday"], { stdin: BODY });

    // #then
    expect([result.exitCode, result.stderr]).toEqual([2, 'brain-dump: --at "yesterday" is not a date and time\n']);
  });

  test("rejects an unknown tool tag", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = run(sandbox, ["write-dump", "--tool", "Cursor", "--slug", "s"], { stdin: BODY });

    // #then
    expect([result.exitCode, result.stderr]).toEqual([2, "brain-dump: --tool must be one of ClaudeCode, Codex\n"]);
  });

  test("leaves out the branch in a repo with a detached HEAD", () => {
    // #given
    const sandbox = makeSandbox();
    const repo = makeRepo(sandbox, "Brain-Dump", "main");
    const git = (...args: string[]) => Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo });
    git("commit", "--quiet", "--allow-empty", "-m", "init");
    git("checkout", "--quiet", "--detach");

    // #when
    const result = run(sandbox, writeDumpArgs(), { stdin: BODY, cwd: repo });

    // #then
    expect(readFileSync(result.stdout.trim(), "utf8").split("\n")[6]).toBe(
      "Session: Claude Code · `~/Projects/Brain-Dump` · 2026-10-05 19:40 · [[Brain-Dump]]",
    );
  });

  test("when the Vault is missing, fails with the reason and prints the complete Dump", () => {
    // #given
    const sandbox = makeSandbox();
    const repo = makeRepo(sandbox, "Brain-Dump", "main");
    writeConfig(sandbox, "vault = ~/Nowhere\n");

    // #when
    const result = run(sandbox, writeDumpArgs("wayfinder charting"), { stdin: BODY, cwd: repo });

    // #then
    expect([result.exitCode, result.stderr, result.stdout]).toEqual([
      1,
      `brain-dump: Vault not found at ${join(sandbox.home, "Nowhere")}\n`,
      `---
tags:
  - dump
  - AIGenerated
  - ClaudeCode
---
Session: Claude Code · \`~/Projects/Brain-Dump\` @ \`main\` · 2026-10-05 19:40 · [[Brain-Dump]]

${BODY}`,
    ]);
  });

  test("when the Inbox cannot be written, fails with the reason instead of crashing", () => {
    // #given
    const sandbox = makeSandbox();
    const inbox = join(sandbox.vault, "Inbox");
    mkdirSync(inbox);
    chmodSync(inbox, 0o555);

    // #when
    const result = run(sandbox, writeDumpArgs(), { stdin: BODY });

    // #then
    expect([result.exitCode, result.stderr.split("\n")[0]]).toEqual([1, `brain-dump: cannot write the Dump into ${inbox}: permission denied`]);
  });

  test("rejects a missing --slug", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = run(sandbox, ["write-dump", "--tool", "ClaudeCode"], { stdin: BODY });

    // #then
    expect([result.exitCode, result.stderr]).toEqual([2, "brain-dump: --slug is required\n"]);
  });

  test("rejects a slug with no usable characters", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = run(sandbox, writeDumpArgs("#?:"), { stdin: BODY });

    // #then
    expect([result.exitCode, result.stderr]).toEqual([2, 'brain-dump: --slug "#?:" has no usable characters\n']);
  });
});
