import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { makeSandbox, readVaultFile, run, writeVaultFile, type Sandbox } from "./harness.ts";

const DAILY = "Research/Briefings/Daily/2026-10-26 Daily Briefing.md";
const WEEKLY = "Research/Briefings/Weekly/2026-W44 Weekly Briefing.md";
const INTERESTS = "Research/Briefings/Interests.md";
const BRIEFING = "# Daily Briefing\n\n- [ ] Keep · A paper\n";

function writeBriefing(sandbox: Sandbox, note: string, contents = BRIEFING) {
  return run(sandbox, ["write-briefing", "--note", note], { stdin: contents });
}

describe("brain-dump write-briefing", () => {
  test("creates a Daily Briefing as given and prints the note and its Run", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = writeBriefing(sandbox, DAILY);

    // #then
    const output = JSON.parse(result.stdout);
    expect([result.exitCode, { ...output, run: typeof output.run }, readVaultFile(sandbox, DAILY)]).toEqual([0, { note: DAILY, run: "string" }, BRIEFING]);
  });

  test("creates a Weekly Briefing", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = writeBriefing(sandbox, WEEKLY);

    // #then
    expect([result.exitCode, readVaultFile(sandbox, WEEKLY)]).toEqual([0, BRIEFING]);
  });
});

describe("brain-dump undo of a Briefing's Run", () => {
  test("removes the Briefing, so the Scan can write it again", () => {
    // #given
    const sandbox = makeSandbox();
    const { run: id } = JSON.parse(writeBriefing(sandbox, DAILY).stdout);

    // #when
    const undone = run(sandbox, ["undo", id, "--confirm"]);

    // #then
    expect([undone.exitCode, existsSync(join(sandbox.vault, DAILY)), writeBriefing(sandbox, DAILY).exitCode]).toEqual([0, false, 0]);
  });

  test("refuses once the Briefing was edited, as when a Keep is ticked", () => {
    // #given
    const sandbox = makeSandbox();
    const { run: id } = JSON.parse(writeBriefing(sandbox, DAILY).stdout);
    writeVaultFile(sandbox, DAILY, BRIEFING.replace("[ ]", "[x]"));

    // #when
    const undone = run(sandbox, ["undo", id, "--confirm"]);

    // #then
    expect([undone.exitCode, readVaultFile(sandbox, DAILY)]).toEqual([1, BRIEFING.replace("[ ]", "[x]")]);
  });
});

describe("brain-dump write-briefing refuses, naming the note and writing nothing", () => {
  const notBriefing = (note: string) => `the Briefing writer may only create Daily and Weekly Briefings, not write ${note}`;
  const cases: [string, string, string][] = [
    ["the Interests Note", INTERESTS, notBriefing(INTERESTS)],
    ["a Daily Briefing with a malformed date", "Research/Briefings/Daily/2026-13-01 Daily Briefing.md", notBriefing("Research/Briefings/Daily/2026-13-01 Daily Briefing.md")],
    ["a Daily Briefing in the Weekly folder", "Research/Briefings/Weekly/2026-10-26 Daily Briefing.md", notBriefing("Research/Briefings/Weekly/2026-10-26 Daily Briefing.md")],
    ["a Weekly Briefing with a malformed week", "Research/Briefings/Weekly/2026-W54 Weekly Briefing.md", notBriefing("Research/Briefings/Weekly/2026-W54 Weekly Briefing.md")],
    ["a note in a subfolder of Daily", "Research/Briefings/Daily/Old/2026-10-26 Daily Briefing.md", notBriefing("Research/Briefings/Daily/Old/2026-10-26 Daily Briefing.md")],
    ["a note elsewhere in Research/Briefings", "Research/Briefings/Notes.md", notBriefing("Research/Briefings/Notes.md")],
    ["a Curated Note", "Research/Main Notes/Agent Skills.md", notBriefing("Research/Main Notes/Agent Skills.md")],
    ["a Dump in the Inbox", "Inbox/2026-10-26 0900 PaperBot - pick.md", notBriefing("Inbox/2026-10-26 0900 PaperBot - pick.md")],
    ["a path climbing out of Research/Briefings", "Research/Briefings/Daily/../../Main Notes/2026-10-26 Daily Briefing.md", notBriefing("Research/Main Notes/2026-10-26 Daily Briefing.md")],
    ["a note outside the write allowlist", "Journal/2026-10-26 Daily Briefing.md", "Journal/2026-10-26 Daily Briefing.md is outside the write allowlist"],
  ];

  for (const [name, note, reason] of cases) {
    test(name, () => {
      // #given
      const sandbox = makeSandbox();

      // #when
      const result = writeBriefing(sandbox, note);

      // #then
      expect([result.exitCode, result.stderr, existsSync(join(sandbox.vault, note))]).toEqual([1, `brain-dump: write refused: ${reason}\n`, false]);
    });
  }

  test("a Briefing that already exists, leaving it as it was", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DAILY, "# Read and ticked\n");

    // #when
    const result = writeBriefing(sandbox, DAILY);

    // #then
    expect([result.exitCode, result.stderr, readVaultFile(sandbox, DAILY)]).toEqual([1, `brain-dump: write refused: ${DAILY} already exists\n`, "# Read and ticked\n"]);
  });

  test("a Briefing holding a secret, naming its line but never the secret", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = writeBriefing(sandbox, DAILY, "# Daily Briefing\npassword=hunter2\n");

    // #then
    expect([result.exitCode, result.stderr, existsSync(join(sandbox.vault, DAILY))]).toEqual([1, `brain-dump: write refused: line 2 of ${DAILY} looks like it holds a password\n`, false]);
  });

  test("a Briefing over the size limit", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = writeBriefing(sandbox, DAILY, "x".repeat(200_001));

    // #then
    expect([result.exitCode, result.stderr, existsSync(join(sandbox.vault, DAILY))]).toEqual([1, `brain-dump: write refused: ${DAILY} is 200001 bytes, more than the 200000 a Briefing may hold\n`, false]);
  });
});
