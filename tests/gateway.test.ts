import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DEV_ORIGIN as ORIGIN, dumpFile, makeSandbox, readVaultFile, run, WEEKLY_TEMPLATE, writeVaultFile, type Sandbox, pinned } from "./harness.ts";

const DUMP = "Inbox/2026-10-05 1940 Brain-Dump - filing.md";
const OTHER_DUMP = "Inbox/2026-10-04 1200 Brain-Dump - other.md";
const WEEK = "Research/Weekly Meetings/10-05-26 Weekly Update.md";
const JOURNAL = "Journal/2026-10-05.md";

function apply(sandbox: Sandbox, plan: unknown) {
  return run(sandbox, ["apply"], { stdin: JSON.stringify(pinned(sandbox, plan)) });
}

function stagedFiles(sandbox: Sandbox): string[] {
  return readdirSync(sandbox.vault, { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith(".brain-dump-tmp"));
}

/** Files Learning 1 into the Weekly Note, which the write allowlist allows, and Learning 2 into `note`. */
function leaking(note: string, extra: object = {}) {
  return { dump: DUMP, items: [{ index: 1, outcome: "filed", note: WEEK, section: "# Notes:" }, { index: 2, outcome: "filed", note }], ...extra };
}

describe("the write gateway refuses the whole plan, writing nothing", () => {
  const cases: [string, (sandbox: Sandbox) => unknown, string][] = [
    ["an Item filed into a note outside the write allowlist", () => leaking(JOURNAL), `${JOURNAL} is outside the write allowlist`],
    ["a new note outside the write allowlist", () => leaking("Journal/New.md", { creates: [{ note: "Journal/New.md", tags: [] }] }), "Journal/New.md is outside the write allowlist"],
    [
      "an Item filed into a note at the Vault root",
      (sandbox) => {
        writeVaultFile(sandbox, "Home.md", "# Home\n");
        return leaking("Home.md");
      },
      "Home.md is outside the write allowlist",
    ],
    [
      "an Item filed into another Dump in the Inbox",
      (sandbox) => {
        writeVaultFile(sandbox, OTHER_DUMP, dumpFile(ORIGIN, "## Todos\n- [ ] #todo Other.\n"));
        return leaking(OTHER_DUMP);
      },
      `${OTHER_DUMP} is in the Inbox, which a plan changes only through its own Dump and the Routes note`,
    ],
    [
      "an Item filed into a note in Inbox/Filed",
      (sandbox) => {
        writeVaultFile(sandbox, "Inbox/Filed/Old.md", "# Old\n");
        return leaking("Inbox/Filed/Old.md");
      },
      "Inbox/Filed/Old.md is in the Inbox, which a plan changes only through its own Dump and the Routes note",
    ],
  ];

  for (const [name, makePlan, reason] of cases) {
    test(name, () => {
      // #given
      const sandbox = makeSandbox();
      const dump = dumpFile(ORIGIN, "## Learnings\n- [ ] A.\n- [ ] B.\n");
      writeVaultFile(sandbox, DUMP, dump);
      writeVaultFile(sandbox, WEEK, WEEKLY_TEMPLATE);
      writeVaultFile(sandbox, JOURNAL, "# Today\n");
      const plan = makePlan(sandbox);

      // #when
      const result = apply(sandbox, plan);

      // #then
      expect({
        exitCode: result.exitCode,
        stderr: result.stderr,
        notes: [readVaultFile(sandbox, DUMP), readVaultFile(sandbox, WEEK), readVaultFile(sandbox, JOURNAL)],
        created: existsSync(join(sandbox.vault, "Journal/New.md")),
        leftovers: stagedFiles(sandbox),
      }).toEqual({
        exitCode: 1,
        stderr: `brain-dump: write refused: ${reason}\n`,
        notes: [dump, WEEKLY_TEMPLATE, "# Today\n"],
        created: false,
        leftovers: [],
      });
    });
  }
});

describe("the write gateway limits a plan to 8 notes unless it carries confirmLarge", () => {
  const notes = Array.from({ length: 8 }, (_, n) => `Resources/Note ${n + 1}.md`);
  const newNote = "Resources/Note 9.md";
  const filedInto = (note: string, index: number) => ({ index, outcome: "filed", note });
  /** Learning N as filed into a note; the Dump keeps Learnings 9 and 10 for the plans that leave it unfinished, so it gets no link line. */
  const filed = (index: number) => `- L${index}.\n\t- From [[2026-10-05 1940 Brain-Dump - filing|dump 10-05-26]]\n`;

  function largePlan(extra: object) {
    return {
      dump: DUMP,
      creates: [{ note: newNote, tags: [] }],
      items: [...notes.map((note, n) => filedInto(note, n + 1)), filedInto(newNote, 9), { index: 10, outcome: "skipped" }],
      ...extra,
    };
  }

  function sandboxWithNotes() {
    const sandbox = makeSandbox();
    const dump = dumpFile(ORIGIN, `## Learnings\n${Array.from({ length: 10 }, (_, n) => `- [ ] L${n + 1}.\n`).join("")}`);
    writeVaultFile(sandbox, DUMP, dump);
    for (const note of notes) writeVaultFile(sandbox, note, "# Note\n");
    return { sandbox, dump };
  }

  test("refuses a plan writing 9 notes, writing nothing", () => {
    // #given
    const { sandbox, dump } = sandboxWithNotes();

    // #when
    const result = apply(sandbox, largePlan({}));

    // #then
    expect({
      exitCode: result.exitCode,
      stderr: result.stderr,
      dump: readVaultFile(sandbox, DUMP),
      notes: notes.map((note) => readVaultFile(sandbox, note)),
      created: existsSync(join(sandbox.vault, newNote)),
      leftovers: stagedFiles(sandbox),
    }).toEqual({
      exitCode: 1,
      stderr: "brain-dump: write refused: the plan writes 9 notes, more than 8, so it needs confirmLarge\n",
      dump,
      notes: notes.map(() => "# Note\n"),
      created: false,
      leftovers: [],
    });
  });

  test("applies the same plan with confirmLarge", () => {
    // #given
    const { sandbox } = sandboxWithNotes();

    // #when
    const result = apply(sandbox, largePlan({ confirmLarge: true }));

    // #then
    expect({
      exitCode: result.exitCode,
      stderr: result.stderr,
      notes: [...notes, newNote].map((note) => readVaultFile(sandbox, note)),
    }).toEqual({
      exitCode: 0,
      stderr: "",
      notes: [...notes.map((_, n) => `# Note\n${filed(n + 1)}`), filed(9)],
    });
  });

  test("doesn't count the Dump or the Routes note toward the 8", () => {
    // #given
    const { sandbox } = sandboxWithNotes();
    const plan = { dump: DUMP, items: notes.map((note, n) => filedInto(note, n + 1)), routes: [{ key: "a", title: "Note 1" }] };

    // #when
    const result = apply(sandbox, plan);

    // #then
    expect({
      exitCode: result.exitCode,
      stderr: result.stderr,
      notes: notes.map((note) => readVaultFile(sandbox, note)),
      routes: readVaultFile(sandbox, "Inbox/Filing Routes.md"),
    }).toEqual({
      exitCode: 0,
      stderr: "",
      notes: notes.map((_, n) => `# Note\n${filed(n + 1)}`),
      routes: "a → [[Note 1]]\n",
    });
  });

  test("rejects a confirmLarge that isn't a boolean", () => {
    // #given
    const { sandbox } = sandboxWithNotes();

    // #when
    const result = apply(sandbox, largePlan({ confirmLarge: "yes" }));

    // #then
    expect({ exitCode: result.exitCode, stderr: result.stderr.startsWith("brain-dump: invalid Filing Plan:") }).toEqual({ exitCode: 2, stderr: true });
  });
});
