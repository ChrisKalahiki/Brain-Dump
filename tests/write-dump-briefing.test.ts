import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DUMP_AT, makeSandbox, run, writeConfig } from "./harness.ts";

const BODY = `## Learnings
- [ ] Sparse autoencoders recover interpretable features from LLM activations (https://arxiv.org/abs/2410.01234).
`;

const BRIEFING = "2026-10-05 Daily Briefing";

function briefingArgs(overrides: Record<string, string | undefined> = {}): string[] {
  const flags = { origin: "briefing", briefing: BRIEFING, paper: "2410.01234", project: "Interpretability", slug: "sparse autoencoders", at: DUMP_AT, ...overrides };
  return ["write-dump", ...Object.entries(flags).flatMap(([flag, value]) => (value === undefined ? [] : [`--${flag}`, value]))];
}

describe("brain-dump write-dump for a Kept Pick from a Briefing", () => {
  test("writes a Dump tagged as kept by paper-bot, linking back to its Briefing and Interest", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = run(sandbox, briefingArgs(), { stdin: BODY });

    // #then
    const path = join(sandbox.vault, "Inbox", "2026-10-05 1940 PaperBot - sparse autoencoders.md");
    expect([result.stdout, readFileSync(path, "utf8")]).toEqual([
      `${path}\n`,
      `---
tags:
  - dump
  - dump/kept
  - AIGenerated
  - PaperBot
paper: 2410.01234
---
Briefing: [[2026-10-05 Daily Briefing]] · 2026-10-05 19:40 · [[Interpretability]]

${BODY}`,
    ]);
  });

  test("refuses a missing Briefing-origin flag, naming it", () => {
    // #given
    const sandbox = makeSandbox();
    const flags = ["briefing", "paper", "project"];

    // #when
    const results = flags.map((flag) => run(sandbox, briefingArgs({ [flag]: undefined }), { stdin: BODY }));

    // #then
    expect(results.map(({ exitCode, stderr }) => [exitCode, stderr])).toEqual(
      flags.map((flag) => [2, `brain-dump: --${flag} is required for the briefing origin\n`]),
    );
  });

  test.each([
    ["briefing", "Briefing]] · [[Elsewhere"],
    ["paper", "2410.01234\ntags: [x]"],
    ["project", "Interp|retability"],
  ])("refuses a malformed --%s, naming it", (flag, value) => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = run(sandbox, briefingArgs({ [flag]: value }), { stdin: BODY });

    // #then
    expect([result.exitCode, result.stderr.startsWith(`brain-dump: --${flag} "${value}" `)]).toEqual([2, true]);
  });

  test("refuses an --origin other than session or briefing", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = run(sandbox, briefingArgs({ origin: "chat" }), { stdin: BODY });

    // #then
    expect([result.exitCode, result.stderr]).toEqual([2, "brain-dump: --origin must be session or briefing\n"]);
  });

  test("refuses a Session-origin flag on the Briefing origin", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = run(sandbox, briefingArgs({ tool: "ClaudeCode" }), { stdin: BODY });

    // #then
    expect([result.exitCode, result.stderr]).toEqual([2, "brain-dump: --tool is only for the session origin\n"]);
  });

  test("refuses a Briefing-origin flag on the Session origin", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = run(sandbox, ["write-dump", "--tool", "ClaudeWeb", "--slug", "s", "--paper", "2410.01234"], { stdin: BODY });

    // #then
    expect([result.exitCode, result.stderr]).toEqual([2, "brain-dump: --paper is only for the briefing origin\n"]);
  });

  test("--dry-run prints the Dump it would write, under the name it would take", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = run(sandbox, [...briefingArgs(), "--dry-run"], { stdin: BODY });

    // #then
    expect(JSON.parse(result.stdout)).toEqual({
      dump: join(sandbox.vault, "Inbox", "2026-10-05 1940 PaperBot - sparse autoencoders.md"),
      contents: `---
tags:
  - dump
  - dump/kept
  - AIGenerated
  - PaperBot
paper: 2410.01234
---
Briefing: [[2026-10-05 Daily Briefing]] · 2026-10-05 19:40 · [[Interpretability]]

${BODY}`,
    });
  });
});

describe("brain-dump write-dump --dry-run", () => {
  test.each([
    ["Session", ["write-dump", "--tool", "ClaudeWeb", "--slug", "s", "--at", DUMP_AT, "--dry-run"]],
    ["Briefing", [...briefingArgs(), "--dry-run"]],
  ])("on the %s origin, succeeds writing no file", (_, args) => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = run(sandbox, args, { stdin: BODY });

    // #then
    expect([result.exitCode, existsSync(join(sandbox.vault, "Inbox"))]).toEqual([0, false]);
  });

  test.each([
    ["Session", ["write-dump", "--tool", "ClaudeWeb", "--slug", "s", "--at", DUMP_AT, "--dry-run"]],
    ["Briefing", [...briefingArgs(), "--dry-run"]],
  ])("on the %s origin, starts no Run", (_, args) => {
    // #given
    const sandbox = makeSandbox();

    // #when
    run(sandbox, args, { stdin: BODY });

    // #then
    expect(JSON.parse(run(sandbox, ["runs"]).stdout)).toEqual([]);
  });

  test("still refuses a Dump that breaks the Dump rules", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = run(sandbox, [...briefingArgs(), "--dry-run"], { stdin: "## Learnings\n" });

    // #then
    expect([result.exitCode, result.stderr]).toEqual([1, 'brain-dump: invalid Dump body: section "## Learnings" has no Items\n']);
  });

  test("still refuses when there is no Vault to write into", () => {
    // #given
    const sandbox = makeSandbox();
    writeConfig(sandbox, "vault = ~/Nowhere\n");

    // #when
    const result = run(sandbox, [...briefingArgs(), "--dry-run"], { stdin: BODY });

    // #then
    expect([result.exitCode, result.stderr]).toEqual([1, `brain-dump: Vault not found at ${join(sandbox.home, "Nowhere")}\n`]);
  });
});
