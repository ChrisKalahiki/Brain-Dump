import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { makeRepo, makeSandbox, run } from "./harness.ts";

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
      ["write-dump", "--tool", "ClaudeCode", "--slug", "wayfinder charting", "--at", "2026-10-05T19:40"],
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
    const args = ["write-dump", "--tool", "ClaudeCode", "--slug", "same", "--at", "2026-10-05T19:40"];

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
    run(sandbox, ["write-dump", "--tool", "ClaudeCode", "--slug", 'auth: OAuth/PKCE [draft] #2 "why?"', "--at", "2026-10-05T19:40"], {
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
});
