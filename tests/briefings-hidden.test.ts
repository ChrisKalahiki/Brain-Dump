import { describe, expect, test } from "bun:test";
import { devOrigin, dumpFile, makeRepo, makeSandbox, run, vaultFileHash, writeVaultFile, type Sandbox } from "./harness.ts";

const FILED_DUMP = "Inbox/Filed/2026-10-01 0900 chronos - queues.md";
const FROM_FILED = "\t- From [[2026-10-01 0900 chronos - queues|dump 10-01-26]]";
const CURATED = "Side Projects/Chronos.md";
const DAILY = "Research/Briefings/Daily/2026-10-26 Daily Briefing.md";
const WEEKLY = "Research/Briefings/Weekly/2026-W44 Weekly Briefing.md";
const INTERESTS = "Research/Briefings/Interests.md";
/** Shaped like filed Items, with a wikilink and a broken backlink, so a reader that didn't skip it would show it. */
const BRIEFING = `# Daily Briefing\n- [ ] Keep · A briefed Learning about [[Schedulers]].\n${FROM_FILED}\n- A Learning from a lost Dump.\n\t- From [[2026-09-01 0900 gone - lost|dump 09-01-26]]\n`;
const INTERESTS_NOTE = "# Interests\n- chronos: job queues, Learning schedulers\n";

/** One filed chronos Learning in a Curated Note, and Briefings and the Interests Note holding look-alike Items. */
function seedVault(sandbox: Sandbox): void {
  writeVaultFile(sandbox, FILED_DUMP, dumpFile(devOrigin("chronos", "2026-10-01T09:00"), "## Learnings\n- [x] A filed Learning.\n"));
  writeVaultFile(sandbox, CURATED, `# Chronos\n- A filed Learning.\n${FROM_FILED}\n`);
  writeVaultFile(sandbox, DAILY, BRIEFING);
  writeVaultFile(sandbox, WEEKLY, BRIEFING);
  writeVaultFile(sandbox, INTERESTS, INTERESTS_NOTE);
}

function json(sandbox: Sandbox, args: string[], options: { cwd?: string } = {}) {
  return JSON.parse(run(sandbox, args, options).stdout);
}

describe("Briefings are hidden from Filing, recall, check and the Vault pointer", () => {
  test("list-notes leaves out Briefings and the Interests Note", () => {
    // #given
    const sandbox = makeSandbox();
    seedVault(sandbox);

    // #when
    const notes: { note: string }[] = json(sandbox, ["list-notes"]);

    // #then
    expect(notes.map(({ note }) => note)).toEqual([CURATED]);
  });

  test("the Outline leaves out Briefings and the Interests Note", () => {
    // #given
    const sandbox = makeSandbox();
    seedVault(sandbox);

    // #when
    const notes: { note: string }[] = json(sandbox, ["outline", "--json"]);

    // #then
    expect(notes.map(({ note }) => note)).toEqual([CURATED]);
  });

  test("recall by terms finds only the Curated Note's Items", () => {
    // #given
    const sandbox = makeSandbox();
    seedVault(sandbox);

    // #when
    const { results }: { results: { note: string }[] } = json(sandbox, ["recall", "Learning"]);

    // #then
    expect(results.map(({ note }) => note)).toEqual([CURATED]);
  });

  test("recall by project finds only the Curated Note's Items", () => {
    // #given
    const sandbox = makeSandbox();
    seedVault(sandbox);

    // #when
    const { results }: { results: { note: string }[] } = json(sandbox, ["recall", "--project", "chronos"]);

    // #then
    expect(results.map(({ note }) => note)).toEqual([CURATED]);
  });

  test("recall by links finds no line in a Briefing", () => {
    // #given
    const sandbox = makeSandbox();
    seedVault(sandbox);

    // #when
    const result = json(sandbox, ["recall", "--links", "[[Schedulers]]"]);

    // #then
    expect(result).toEqual({ links: [] });
  });

  test("check reports nothing in a Briefing", () => {
    // #given
    const sandbox = makeSandbox();
    seedVault(sandbox);

    // #when
    const result = run(sandbox, ["check", "--json"]);

    // #then
    expect([result.exitCode, JSON.parse(result.stdout)]).toEqual([0, []]);
  });

  test("the Vault pointer counts only the Curated Note's Items", () => {
    // #given
    const sandbox = makeSandbox();
    seedVault(sandbox);
    const repo = makeRepo(sandbox, "chronos", "main");

    // #when
    const result = run(sandbox, ["pointer"], { cwd: repo, now: "2026-10-27T09:00" });

    // #then
    expect(result.stdout).toBe("brain-dump: Vault notes for chronos: [[Chronos]] (1 Item) · use the recall skill for more\n");
  });
});

describe("brain-dump show --full reads Briefings", () => {
  const cases: [string, string, string][] = [
    ["a Daily Briefing", DAILY, BRIEFING],
    ["a Weekly Briefing", WEEKLY, BRIEFING],
    ["the Interests Note", INTERESTS, INTERESTS_NOTE],
  ];

  for (const [name, note, contents] of cases) {
    test(name, () => {
      // #given
      const sandbox = makeSandbox();
      seedVault(sandbox);

      // #when
      const result = json(sandbox, ["show", note, "--full"]);

      // #then
      expect(result).toEqual({ note, hash: vaultFileHash(sandbox, note), text: contents, truncated: false });
    });
  }
});
