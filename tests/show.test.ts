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
