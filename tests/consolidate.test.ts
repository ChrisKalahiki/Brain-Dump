import { describe, expect, test } from "bun:test";
import { makeSandbox, readVaultFile, run, type Sandbox, vaultFileHash, writeVaultFile } from "./harness.ts";

const NOTE = "Research/Main Notes/Agent Skills.md";
const WEEK = "Research/Weekly Meetings/10-12-26 Weekly Update.md";
const NOW = "2026-10-12T09:00";
const BULLETS = ["Codex reads skills from ~/.agents/skills [[2026-10-05 1940 B - s|dump 10-05-26]]", "Skills load lazily (hand-added)", "Prefer one skill per verb [[2026-10-05 1940 B - s|dump 10-05-26]]"];
const filed = (text: string) => `- ${text}\n\t- From [[2026-10-05 1940 B - s|dump 10-05-26]]\n`;

/** With `--confirm`, the plan carries the `digest` its preview prints, as the skill's does. */
function consolidate(sandbox: Sandbox, note: string, plan: object, flags: string[] = []) {
  const stdin = (extra: object) => JSON.stringify({ expect: { [note]: vaultFileHash(sandbox, note) }, bullets: BULLETS, ...extra, ...plan });
  const digest = flags.includes("--confirm") ? JSON.parse(run(sandbox, ["consolidate", note], { now: NOW, stdin: stdin({}) }).stdout || "{}").digest : undefined;
  return run(sandbox, ["consolidate", note, ...flags], { now: NOW, stdin: stdin({ digest }) });
}

describe("brain-dump consolidate", () => {
  test("previews the Digest without writing when not confirmed", () => {
    // #given
    const sandbox = makeSandbox();
    const before = `# Agent Skills\n${filed("A.")}${filed("B.")}`;
    writeVaultFile(sandbox, NOTE, before);

    // #when
    const result = consolidate(sandbox, NOTE, {});

    // #then
    expect({ exitCode: result.exitCode, preview: JSON.parse(result.stdout), note: readVaultFile(sandbox, NOTE) }).toEqual({
      exitCode: 0,
      preview: {
        note: NOTE,
        digest: "^digest-101226",
        supersedes: null,
        items: 2,
        lines: ["> [!summary] Digest 10-12-26", ...BULLETS.map((bullet) => `> - ${bullet}`), "^digest-101226"],
      },
      note: before,
    });
  });

  test("appends the Digest after a blank line at the note's end as one Run when confirmed", () => {
    // #given
    const sandbox = makeSandbox();
    const before = `# Agent Skills\n${filed("A.")}`;
    writeVaultFile(sandbox, NOTE, before);

    // #when
    const result = consolidate(sandbox, NOTE, {}, ["--confirm"]);

    // #then
    const runs = JSON.parse(run(sandbox, ["runs"]).stdout);
    expect({ exitCode: result.exitCode, note: readVaultFile(sandbox, NOTE), run: JSON.parse(result.stdout).run, command: runs[0].command }).toEqual({
      exitCode: 0,
      note: `${before}\n> [!summary] Digest 10-12-26\n${BULLETS.map((bullet) => `> - ${bullet}\n`).join("")}^digest-101226\n`,
      run: runs[0].id,
      command: "consolidate",
    });
  });

  test("ends an unterminated last line before appending", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, NOTE, `# Agent Skills\n${filed("A.").trimEnd()}`);

    // #when
    consolidate(sandbox, NOTE, {}, ["--confirm"]);

    // #then
    expect(readVaultFile(sandbox, NOTE)).toStartWith(`# Agent Skills\n${filed("A.")}\n> [!summary] Digest 10-12-26\n`);
  });

  test("keeps a CRLF note's line endings", () => {
    // #given
    const sandbox = makeSandbox();
    const before = "# Agent Skills\r\n- A.\r\n\t- From [[2026-10-05 1940 B - s|dump 10-05-26]]\r\n";
    writeVaultFile(sandbox, NOTE, before);

    // #when
    consolidate(sandbox, NOTE, {}, ["--confirm"]);

    // #then
    expect(readVaultFile(sandbox, NOTE)).toBe(`${before}\r\n> [!summary] Digest 10-12-26\r\n${BULLETS.map((bullet) => `> - ${bullet}\r\n`).join("")}^digest-101226\r\n`);
  });

  test("ignores a Digest ID line that closes no Digest callout", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, NOTE, `# Agent Skills\n${filed("A.")}^digest-100126\n${filed("B.")}`);

    // #when
    const preview = JSON.parse(consolidate(sandbox, NOTE, {}).stdout);

    // #then
    expect({ supersedes: preview.supersedes, items: preview.items }).toEqual({ supersedes: null, items: 2 });
  });

  test("supersedes the latest Digest, counting only Items filed after it", () => {
    // #given
    const sandbox = makeSandbox();
    const earlier = "> [!summary] Digest 10-01-26\n> - Old theme\n^digest-100126\n";
    writeVaultFile(sandbox, NOTE, `# Agent Skills\n${filed("A.")}\n${earlier}${filed("B.")}${filed("C.")}`);

    // #when
    const preview = JSON.parse(consolidate(sandbox, NOTE, {}).stdout);

    // #then
    expect({ supersedes: preview.supersedes, items: preview.items, head: preview.lines.slice(0, 2) }).toEqual({
      supersedes: "^digest-100126",
      items: 2,
      head: ["> [!summary] Digest 10-12-26", "> Supersedes [[#^digest-100126]] · 2 Items"],
    });
  });

  test("numbers a second and third Digest on the same day", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, NOTE, `# Agent Skills\n${filed("A.")}`);
    consolidate(sandbox, NOTE, {}, ["--confirm"]);
    writeVaultFile(sandbox, NOTE, `${readVaultFile(sandbox, NOTE)}${filed("B.")}`);
    consolidate(sandbox, NOTE, {}, ["--confirm"]);
    writeVaultFile(sandbox, NOTE, `${readVaultFile(sandbox, NOTE)}${filed("C.")}`);

    // #when
    const preview = JSON.parse(consolidate(sandbox, NOTE, {}).stdout);

    // #then
    expect({ digest: preview.digest, supersedes: preview.supersedes, head: preview.lines.slice(0, 2), last: preview.lines.at(-1) }).toEqual({
      digest: "^digest-101226-3",
      supersedes: "^digest-101226-2",
      head: ["> [!summary] Digest 10-12-26 (3)", "> Supersedes [[#^digest-101226-2]] · 1 Item"],
      last: "^digest-101226-3",
    });
  });

  test("finds the note by title or wikilink", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, NOTE, `# Agent Skills\n${filed("A.")}`);
    const plan = JSON.stringify({ expect: { [NOTE]: vaultFileHash(sandbox, NOTE) }, bullets: BULLETS });

    // #when
    const result = run(sandbox, ["consolidate", "[[Agent Skills]]"], { now: NOW, stdin: plan });

    // #then
    expect({ exitCode: result.exitCode, note: JSON.parse(result.stdout).note }).toEqual({ exitCode: 0, note: NOTE });
  });

  const refusals: [string, string, string, (sandbox: Sandbox) => object, string][] = [
    ["an Inbox note", "Inbox/Notes.md", `# Notes\n${filed("A.")}`, () => ({}), "Inbox/Notes.md is in the Inbox, and only Topic Notes and Project Notes take a Digest"],
    ["a Weekly Note", WEEK, `# Notes:\n${filed("A.")}`, () => ({}), `${WEEK} is a Weekly Note, and only Topic Notes and Project Notes take a Digest`],
    ["a note with no filed Item", NOTE, "# Agent Skills\n- Hand-written.\n", () => ({}), `${NOTE} has no filed Item to consolidate`],
    [
      "a note with no filed Item since its latest Digest",
      NOTE,
      `# Agent Skills\n${filed("A.")}\n> [!summary] Digest 10-01-26\n> - Old\n^digest-100126\n`,
      () => ({}),
      `${NOTE} has no filed Item since ^digest-100126`,
    ],
    ["a confirm without the previewed Digest ID", NOTE, `# Agent Skills\n${filed("A.")}`, () => ({ digest: undefined }), "Consolidation plan rejected: --confirm needs the digest its preview printed"],
    ["a Digest ID that changed since the preview", NOTE, `# Agent Skills\n${filed("A.")}`, () => ({ digest: "^digest-101126" }), "Consolidation plan stale: the Digest would now be ^digest-101226, not ^digest-101126"],
    ["a plan with no hash for the note", NOTE, `# Agent Skills\n${filed("A.")}`, () => ({ expect: {} }), `Consolidation plan rejected: expect has no hash for ${NOTE}`],
  ];

  for (const [name, note, contents, plan, reason] of refusals) {
    test(`refuses ${name}, writing nothing`, () => {
      // #given
      const sandbox = makeSandbox();
      writeVaultFile(sandbox, note, contents);

      // #when
      const result = consolidate(sandbox, note, plan(sandbox), ["--confirm"]);

      // #then
      expect({ exitCode: result.exitCode, stderr: result.stderr, note: readVaultFile(sandbox, note) }).toEqual({ exitCode: 1, stderr: `brain-dump: ${reason}\n`, note: contents });
    });
  }

  test("refuses a stale plan when the note changed since it was read", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, NOTE, `# Agent Skills\n${filed("A.")}`);
    const stale = { expect: { [NOTE]: vaultFileHash(sandbox, NOTE) }, bullets: BULLETS };
    const changed = `# Agent Skills\n${filed("A.")}${filed("B.")}`;
    writeVaultFile(sandbox, NOTE, changed);

    // #when
    const result = run(sandbox, ["consolidate", NOTE, "--confirm"], { now: NOW, stdin: JSON.stringify(stale) });

    // #then
    expect({ exitCode: result.exitCode, stderr: result.stderr, note: readVaultFile(sandbox, NOTE) }).toEqual({
      exitCode: 1,
      stderr: `brain-dump: Consolidation plan stale: ${NOTE} changed since it was read\n`,
      note: changed,
    });
  });

  test("reads a plan written as block YAML, which a Bash command can carry without braces", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, NOTE, `# Agent Skills\n${filed("A.")}`);
    const plan = [
      "expect:",
      `  "${NOTE}": "${vaultFileHash(sandbox, NOTE)}"`,
      "bullets:",
      ...BULLETS.map((bullet) => `  - "${bullet}"`),
      "",
    ].join("\n");

    // #when
    const result = run(sandbox, ["consolidate", NOTE], { now: NOW, stdin: plan });

    // #then
    expect({ exitCode: result.exitCode, stderr: result.stderr, lines: JSON.parse(result.stdout || "{}").lines }).toEqual({
      exitCode: 0,
      stderr: "",
      lines: ["> [!summary] Digest 10-12-26", ...BULLETS.map((bullet) => `> - ${bullet}`), "^digest-101226"],
    });
  });

  test("rejects stdin that isn't YAML", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, NOTE, `# Agent Skills\n${filed("A.")}`);

    // #when
    const result = run(sandbox, ["consolidate", NOTE], { now: NOW, stdin: "bullets: [" });

    // #then
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 2, stderr: "brain-dump: invalid consolidation plan: stdin is not YAML\n" });
  });

  const badPlans: [string, object][] = [
    ["2 bullets", { bullets: BULLETS.slice(0, 2) }],
    ["11 bullets", { bullets: Array.from({ length: 11 }, (_, n) => `Theme ${n}`) }],
    ["a blank bullet", { bullets: [...BULLETS, "  "] }],
    ["a bullet over two lines", { bullets: [...BULLETS, "One\nTwo"] }],
    ["a bullet that already starts with a dash", { bullets: [...BULLETS, "- Theme"] }],
  ];

  for (const [name, plan] of badPlans) {
    test(`rejects a plan with ${name} as invalid`, () => {
      // #given
      const sandbox = makeSandbox();
      writeVaultFile(sandbox, NOTE, `# Agent Skills\n${filed("A.")}`);

      // #when
      const result = consolidate(sandbox, NOTE, plan, ["--confirm"]);

      // #then
      expect({ exitCode: result.exitCode, shape: result.stderr.startsWith("brain-dump: invalid consolidation plan: expected {") }).toEqual({ exitCode: 2, shape: true });
    });
  }

  test("is undone exactly by undo", () => {
    // #given
    const sandbox = makeSandbox();
    const before = `# Agent Skills\n${filed("A.")}`;
    writeVaultFile(sandbox, NOTE, before);
    const { run: id } = JSON.parse(consolidate(sandbox, NOTE, {}, ["--confirm"]).stdout);

    // #when
    const result = run(sandbox, ["undo", id, "--confirm"], { now: NOW });

    // #then
    expect({ exitCode: result.exitCode, note: readVaultFile(sandbox, NOTE) }).toEqual({ exitCode: 0, note: before });
  });
});
