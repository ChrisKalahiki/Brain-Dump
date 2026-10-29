import { describe, expect, test } from "bun:test";
import { makeSandbox, run, vaultFileHash, writeVaultFile, type Sandbox } from "./harness.ts";

const NOTE = "Side Projects/Chronos.md";
const OLD_DIGEST = "> [!summary] Digest 10-01-26\n> - Queues are FIFO.\n\n^digest-100126\n";
const LATEST_DIGEST = "> [!summary] Digest 10-10-26 (2)\n> Supersedes [[#^digest-100126]] · 3 Items\n> - Queues are FIFO, with retries.\n\n^digest-101026-2\n";

function show(sandbox: Sandbox, args: string[]) {
  const result = run(sandbox, ["show", ...args]);
  return result.exitCode === 0 ? JSON.parse(result.stdout) : result;
}

describe("brain-dump show", () => {
  test("returns the latest Digest and everything after it, with the note's hash", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, NOTE, `# Chronos\n- early Item\n${OLD_DIGEST}- middle Item\n${LATEST_DIGEST}- late Item\n`);

    // #when
    const result = show(sandbox, [NOTE]);

    // #then
    expect(result).toEqual({ note: NOTE, hash: vaultFileHash(sandbox, NOTE), text: `${LATEST_DIGEST}- late Item\n`, truncated: false });
  });

  test("returns the whole note when it has no Digest", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, NOTE, "# Chronos\n- an Item\n");

    // #when
    const result = show(sandbox, [NOTE]);

    // #then
    expect(result.text).toBe("# Chronos\n- an Item\n");
  });

  test("finds the note by its title or wikilink", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, NOTE, "# Chronos\n");

    // #when
    const result = [show(sandbox, ["Chronos"]).note, show(sandbox, ["[[Chronos]]"]).note];

    // #then
    expect(result).toEqual([NOTE, NOTE]);
  });

  test("caps the text at 60,000 characters and says it was truncated", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, NOTE, "x".repeat(70_000));

    // #when
    const result = show(sandbox, [NOTE]);

    // #then
    expect([result.text.length, result.truncated]).toEqual([60_000, true]);
  });

  test("--full returns the whole note, past any Digest and with no cap", () => {
    // #given
    const sandbox = makeSandbox();
    const contents = `# Chronos\n${OLD_DIGEST}${"x".repeat(70_000)}\n`;
    writeVaultFile(sandbox, NOTE, contents);

    // #when
    const result = show(sandbox, [NOTE, "--full"]);

    // #then
    expect([result.text, result.truncated]).toEqual([contents, false]);
  });

  test.each([
    ["a note outside the write allowlist", "Private/Journal.md"],
    ["a path climbing out of the Vault", "Side Projects/../../secret.md"],
  ])("refuses %s", (_, note) => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, "Private/Journal.md", "secret\n");

    // #when
    const result = run(sandbox, ["show", note]);

    // #then
    expect([result.exitCode, result.stderr]).toEqual([1, `brain-dump: ${note} is not a note in the write allowlist\n`]);
  });

  test("names every note a title matches when it is ambiguous", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, "Side Projects/Plan.md", "");
    writeVaultFile(sandbox, "Resources/Plan.md", "");

    // #when
    const result = run(sandbox, ["show", "[[Plan]]"]);

    // #then
    expect([result.exitCode, result.stderr]).toEqual([1, "brain-dump: [[Plan]] matches Resources/Plan.md and Side Projects/Plan.md; pass its path\n"]);
  });
});

describe("brain-dump show a Section", () => {
  const FILED = "- Queues are FIFO.\n\t- From [[2026-10-05 1940 Brain-Dump - filing|dump 10-05-26]]\n";
  const CONTENTS = `intro\n## Week 1\n### Notes\nfirst\n${FILED}## Week 2\n### Notes\nsecond\n${LATEST_DIGEST}`;

  test("returns the Section with its nested Sections and without filed lines, with the whole note's hash", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, NOTE, CONTENTS);

    // #when
    const result = show(sandbox, ["[[Chronos#Week 1]]"]);

    // #then
    expect(result).toEqual({ note: NOTE, section: "[[Chronos#Week 1]]", hash: vaultFileHash(sandbox, NOTE), text: "## Week 1\n### Notes\nfirst\n", truncated: false });
  });

  test("caps a Section's text at 60,000 characters unless --full", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, NOTE, `## Big\n${"x".repeat(70_000)}\n`);

    // #when
    const result = [show(sandbox, ["[[Chronos#Big]]"]), show(sandbox, ["[[Chronos#Big]]", "--full"])].map(({ text, truncated }) => [text.length, truncated]);

    // #then
    expect(result).toEqual([
      [60_000, true],
      [70_008, false],
    ]);
  });

  test("refuses a name matching several Sections, naming their lines and a full path", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, NOTE, CONTENTS);

    // #when
    const result = run(sandbox, ["show", "[[Chronos#Notes]]"]);

    // #then
    expect([result.exitCode, result.stderr]).toEqual([
      1,
      "brain-dump: [[Chronos#Notes]] matches lines 3 and 8 of Chronos; pass its full path, e.g. [[Chronos#Week 1#Notes]]\n",
    ]);
  });

  test("refuses an unknown Section with the nearest Section names in the note", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, NOTE, CONTENTS);

    // #when
    const result = run(sandbox, ["show", "[[Chronos#Week 3]]"]);

    // #then
    expect([result.exitCode, result.stderr]).toEqual([
      1,
      "brain-dump: [[Chronos#Week 3]] is not a Section of Chronos; nearest: [[Chronos#Week 1]], [[Chronos#Week 2]], [[Chronos#Week 1#Notes]], [[Chronos#Week 2#Notes]]\n",
    ]);
  });

  test("refuses an unknown note with the nearest note titles", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, NOTE, CONTENTS);
    writeVaultFile(sandbox, "Resources/Kairos.md", "");
    writeVaultFile(sandbox, "Private/Chronicle.md", "");

    // #when
    const result = run(sandbox, ["show", "[[Chronoss#Week 1]]"]);

    // #then
    expect([result.exitCode, result.stderr]).toEqual([1, "brain-dump: [[Chronoss#Week 1]] is not a note in the write allowlist; nearest: Chronos, Kairos\n"]);
  });

  test("--filed returns the note's filed lines and Digests in order", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, NOTE, CONTENTS);

    // #when
    const result = show(sandbox, ["[[Chronos]]", "--filed"]);

    // #then
    expect(result).toEqual({ note: NOTE, hash: vaultFileHash(sandbox, NOTE), text: `${FILED}${LATEST_DIGEST}`, truncated: false });
  });

  test("refuses --filed with a Section name as a usage error", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, NOTE, CONTENTS);

    // #when
    const result = run(sandbox, ["show", "[[Chronos#Week 1]]", "--filed"]);

    // #then
    expect([result.exitCode, result.stderr]).toEqual([2, "brain-dump: --filed can't be combined with a Section name\n"]);
  });

  test("refuses a Section of a note outside the write allowlist", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, "Private/Journal.md", "## Secrets\nx\n");

    // #when
    const result = run(sandbox, ["show", "[[Private/Journal#Secrets]]"]);

    // #then
    expect([result.exitCode, result.stderr.startsWith("brain-dump: [[Private/Journal#Secrets]] is not a note in the write allowlist")]).toEqual([1, true]);
  });
});
