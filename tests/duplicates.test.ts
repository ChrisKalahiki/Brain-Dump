import { describe, expect, test } from "bun:test";
import { DEV_ORIGIN as ORIGIN, dumpFile, makeSandbox, pinned, readVaultFile, ROUTES_NOTE, run, type Sandbox, writeVaultFile } from "./harness.ts";

const DUMP = "Inbox/2026-10-05 1940 Brain-Dump - filing.md";
const OTHER_DUMP = "Inbox/2026-10-06 0900 Brain-Dump - sweep.md";
const TOPIC = "Research/Main Notes/Agent Skills.md";
const WEEK = "Research/Weekly Meetings/10-05-26 Weekly Update.md";

type Similar = { note: string; text: string; score: number; done: boolean };
type ListedItem = { index: number; state: string; similar?: Similar };

function similarByIndex(sandbox: Sandbox, file = DUMP): Record<number, Similar | undefined> {
  const dumps: { file: string; items: ListedItem[] }[] = JSON.parse(run(sandbox, ["list-dumps"]).stdout);
  const dump = dumps.find((candidate) => candidate.file === file);
  return Object.fromEntries((dump?.items ?? []).map((item) => [item.index, item.similar]));
}

describe("list-dumps marks each open Item's nearest duplicate", () => {
  test("matches a filed Learning despite case, punctuation and stopwords", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Learnings\n- [ ] Codex reads skills from the agents folder.\n"));
    writeVaultFile(sandbox, TOPIC, "# Agent Skills\n- codex reads its skills from an Agents folder\n\t- From [[2026-10-01 0900 Brain-Dump - earlier|dump 10-01-26]]\n");

    // #when
    const similar = similarByIndex(sandbox);

    // #then
    expect(similar[1]).toEqual({ note: TOPIC, text: "codex reads its skills from an Agents folder", score: 1, done: false });
  });

  test("labels a match against a done Todo", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Todos\n- [ ] #todo Ship the file skill today.\n"));
    writeVaultFile(sandbox, WEEK, "# To-Do:\n- Brain Dump\n\t- [x] Ship the file skill today. #todo\n");

    // #when
    const similar = similarByIndex(sandbox);

    // #then
    expect(similar[1]).toEqual({ note: WEEK, text: "[x] Ship the file skill today. #todo", score: 1, done: true });
  });

  test("ignores dropped Items in curated notes", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Todos\n- [ ] #todo Ship the file skill today.\n"));
    writeVaultFile(sandbox, WEEK, "# To-Do:\n- [-] Ship the file skill today. #todo\n");

    // #when
    const similar = similarByIndex(sandbox);

    // #then
    expect(similar[1]).toBeUndefined();
  });

  test("matches open Items of other Inbox Dumps, but not its own Dump's or closed ones", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Learnings\n- [ ] Bun runs TypeScript files directly.\n- [ ] Bun runs TypeScript files directly!\n- [ ] Sweep drafts one Dump nightly.\n"));
    writeVaultFile(sandbox, OTHER_DUMP, dumpFile(ORIGIN, "## Learnings\n- [ ] bun runs typescript files directly\n- [x] Sweep drafts one Dump nightly.\n"));

    // #when
    const similar = similarByIndex(sandbox);

    // #then
    expect(similar).toEqual({
      1: { note: OTHER_DUMP, text: "bun runs typescript files directly", score: 1, done: false },
      2: { note: OTHER_DUMP, text: "bun runs typescript files directly", score: 1, done: false },
      3: undefined,
    });
  });

  test("needs Jaccard 0.7 or more, inclusive, and keeps the best match", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Learnings\n- [ ] alpha beta gamma delta epsilon zeta eta theta iota kappa\n- [ ] red orange yellow green blue indigo violet black white grey\n"));
    const notes = [
      "- alpha beta gamma delta epsilon zeta eta lambda\n\t- Why: 7 of 11 words.\n",
      "- alpha beta gamma delta epsilon zeta eta theta lambda\n\t- Why: 8 of 11 words.\n",
      "- red orange yellow green blue indigo violet\n\t- Why: 7 of 10 words.\n",
    ];
    writeVaultFile(sandbox, TOPIC, `# Agent Skills\n${notes.join("")}`);

    // #when
    const similar = similarByIndex(sandbox);

    // #then
    expect(similar).toEqual({
      1: { note: TOPIC, text: "alpha beta gamma delta epsilon zeta eta theta lambda", score: 0.73, done: false },
      2: { note: TOPIC, text: "red orange yellow green blue indigo violet", score: 0.7, done: false },
    });
  });

  test("needs at least 3 words on each side once stopwords are gone", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Learnings\n- [ ] Use the Bun runtime.\n- [ ] Use the Bun.\n"));
    writeVaultFile(sandbox, TOPIC, "# Agent Skills\n- Use the Bun runtime.\n\t- Why: same words.\n- Use the Bun.\n\t- Why: two words.\n");

    // #when
    const similar = similarByIndex(sandbox);

    // #then
    expect(similar).toEqual({ 1: { note: TOPIC, text: "Use the Bun runtime.", score: 1, done: false }, 2: undefined });
  });

  test("ignores notes outside the write allowlist and Dumps already filed", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Learnings\n- [ ] Bun runs TypeScript files directly.\n"));
    writeVaultFile(sandbox, "Journal/Private.md", "- Bun runs TypeScript files directly.\n\t- Why: private.\n");
    writeVaultFile(sandbox, "Inbox/Filed/2026-10-01 0900 Brain-Dump - old.md", dumpFile(ORIGIN, "## Learnings\n- [ ] Bun runs TypeScript files directly.\n"));

    // #when
    const similar = similarByIndex(sandbox);

    // #then
    expect(similar[1]).toBeUndefined();
  });
});

describe("apply refuses a near-duplicate claimed as routine", () => {
  test("rejects the whole plan, naming the match, and writes nothing", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Learnings\n- [ ] Codex reads skills from the agents folder.\n"));
    writeVaultFile(sandbox, TOPIC, "# Agent Skills\n- Codex reads skills from the agents folder.\n\t- Why: seen before.\n");
    writeVaultFile(sandbox, ROUTES_NOTE, "Agent Skills → [[Agent Skills]]\n");
    const before = [DUMP, TOPIC].map((note) => readVaultFile(sandbox, note));
    const items = [{ index: 1, outcome: "filed", note: TOPIC, route: "Agent Skills" }];

    // #when
    const result = run(sandbox, ["apply"], { stdin: JSON.stringify(pinned(sandbox, { dump: DUMP, items })) });

    // #then
    expect({ exitCode: result.exitCode, stderr: result.stderr, vault: [DUMP, TOPIC].map((note) => readVaultFile(sandbox, note)) }).toEqual({
      exitCode: 1,
      stderr: `brain-dump: Filing Plan rejected: Item 1 claims Route "Agent Skills", but it nearly duplicates "Codex reads skills from the agents folder." in [[Agent Skills]]\n`,
      vault: before,
    });
  });

  test("files a near-duplicate that isn't claimed as routine", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Learnings\n- [ ] Codex reads skills from the agents folder.\n"));
    writeVaultFile(sandbox, TOPIC, "# Agent Skills\n- Codex reads skills from the agents folder.\n\t- Why: seen before.\n");
    writeVaultFile(sandbox, WEEK, "# Notes:\n- \n");
    const items = [{ index: 1, outcome: "filed", note: TOPIC }];

    // #when
    const result = run(sandbox, ["apply"], { stdin: JSON.stringify(pinned(sandbox, { dump: DUMP, items })) });

    // #then
    expect({ exitCode: result.exitCode, topic: readVaultFile(sandbox, TOPIC) }).toEqual({
      exitCode: 0,
      topic:
        "# Agent Skills\n- Codex reads skills from the agents folder.\n\t- Why: seen before.\n- Codex reads skills from the agents folder.\n\t- From [[2026-10-05 1940 Brain-Dump - filing|dump 10-05-26]]\n",
    });
  });
});
