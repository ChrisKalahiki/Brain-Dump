import { describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DEV_ORIGIN as ORIGIN, dumpFile, makeSandbox, pinned, readVaultFile, ROUTES_NOTE, run, type Sandbox, writeVaultFile } from "./harness.ts";

const DUMP = "Inbox/2026-10-05 1940 Brain-Dump - filing.md";
const TOPIC = "Research/Main Notes/Agent Skills.md";
const OTHER = "Research/Main Notes/Zotero.md";
const WEEK = "Research/Weekly Meetings/10-05-26 Weekly Update.md";
const ROUTES = "Agent Skills → [[Agent Skills]]\nZotero → [[Zotero]]\nDissertation → To-Do › Dissertation\n";

function setup(routes = ROUTES): Sandbox {
  const sandbox = makeSandbox();
  writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Learnings\n- [ ] Codex reads skills.\n## Todos\n- [ ] #todo Finish IRB.\n"));
  writeVaultFile(sandbox, TOPIC, "# Agent Skills\n");
  writeVaultFile(sandbox, OTHER, "# Zotero\n");
  writeVaultFile(sandbox, WEEK, "# To-Do:\n- Dissertation\n\t- [ ] Update consent form\n");
  writeVaultFile(sandbox, ROUTES_NOTE, routes);
  return sandbox;
}

const learning = (extra: object = {}) => ({ index: 1, outcome: "filed", note: TOPIC, lines: ["- Codex reads skills."], ...extra });
const todo = (extra: object = {}) => ({ index: 2, outcome: "filed", note: WEEK, section: "# To-Do:", group: ["Dissertation"], lines: ["- [ ] Finish IRB. #todo"], ...extra });

function apply(sandbox: Sandbox, plan: object) {
  return run(sandbox, ["apply"], { stdin: JSON.stringify(pinned(sandbox, { dump: DUMP, inserts: [], ...plan })) });
}

function vaultState(sandbox: Sandbox) {
  return [DUMP, TOPIC, WEEK, ROUTES_NOTE].map((note) => readVaultFile(sandbox, note));
}

describe("brain-dump apply verifies the Route each routine Item claims", () => {
  test("files routine Items whose Routes point at their existing note and Todo Group", () => {
    // #given
    const sandbox = setup();

    // #when
    const result = apply(sandbox, { items: [learning({ route: "Agent Skills" }), todo({ route: "Dissertation" })] });

    // #then
    expect({ exitCode: result.exitCode, topic: readVaultFile(sandbox, TOPIC), week: readVaultFile(sandbox, WEEK) }).toEqual({
      exitCode: 0,
      topic: "# Agent Skills\n- Codex reads skills.\n",
      week: "# To-Do:\n- Dissertation\n\t- [ ] Update consent form\n\t- [ ] Finish IRB. #todo\n",
    });
  });

  test("matches the Route's target ignoring case, as Obsidian and Todo Groups do", () => {
    // #given
    const sandbox = setup("Agent Skills → [[agent skills]]\nDissertation → To-Do › dissertation:\n");

    // #when
    const result = apply(sandbox, { items: [learning({ route: "Agent Skills" }), todo({ route: "Dissertation" })] });

    // #then
    expect({ exitCode: result.exitCode, topic: readVaultFile(sandbox, TOPIC), week: readVaultFile(sandbox, WEEK) }).toEqual({
      exitCode: 0,
      topic: "# Agent Skills\n- Codex reads skills.\n",
      week: "# To-Do:\n- Dissertation\n\t- [ ] Update consent form\n\t- [ ] Finish IRB. #todo\n",
    });
  });

  const refusals: [string, () => Sandbox, object, string][] = [
    ["a Route the Routes note doesn't have", () => setup(), { items: [learning({ route: "Skills" })] }, `Item 1 claims Route "Skills", which the Routes note doesn't have`],
    ["a Route whose key differs only in case", () => setup(), { items: [learning({ route: "agent skills" })] }, `Item 1 claims Route "agent skills", which the Routes note doesn't have`],
    ["a Route the Routes note doesn't have, because it is empty", () => setup(""), { items: [learning({ route: "Agent Skills" })] }, `Item 1 claims Route "Agent Skills", which the Routes note doesn't have`],
    ["a note Route pointing at a different note", () => setup(), { items: [learning({ route: "Zotero" })] }, `Item 1 claims Route "Zotero", which doesn't point at [[Agent Skills]]`],
    ["a note Route for a grouped Todo", () => setup(), { items: [todo({ route: "Agent Skills" })] }, `Item 2 claims Route "Agent Skills", which doesn't point at To-Do › Dissertation`],
    [
      "a group Route pointing at a different group",
      () => setup(),
      { items: [todo({ route: "Dissertation", group: ["Dissertation", "IRB"] })], createGroups: [["Dissertation", "IRB"]] },
      `Item 2 claims Route "Dissertation", which doesn't point at To-Do › Dissertation › IRB`,
    ],
    [
      "a group Route for a Todo filed outside a Weekly Note",
      () => {
        const sandbox = setup();
        writeVaultFile(sandbox, TOPIC, "# To-Do:\n- Dissertation\n");
        return sandbox;
      },
      { items: [todo({ note: TOPIC, route: "Dissertation" })] },
      `Item 2 claims Route "Dissertation", which doesn't point at To-Do › Dissertation`,
    ],
    ["a group Route for an Item filed into a note", () => setup(), { items: [learning({ route: "Dissertation" })] }, `Item 1 claims Route "Dissertation", which doesn't point at [[Agent Skills]]`],
    [
      "a Route only this plan adds",
      () => setup(""),
      { items: [learning({ route: "Agent Skills" })], routes: [{ key: "Agent Skills", title: "Agent Skills" }] },
      `Item 1 claims Route "Agent Skills", which the Routes note doesn't have`,
    ],
  ];

  for (const [name, given, plan, reason] of refusals) {
    test(`refuses the whole plan, writing nothing, for ${name}`, () => {
      // #given
      const sandbox = given();
      const before = vaultState(sandbox);

      // #when
      const result = apply(sandbox, plan);

      // #then
      expect({ exitCode: result.exitCode, stderr: result.stderr, vault: vaultState(sandbox) }).toEqual({
        exitCode: 1,
        stderr: `brain-dump: Filing Plan rejected: ${reason}\n`,
        vault: before,
      });
    });
  }

  test("refuses a routine Item when there is no Routes note at all", () => {
    // #given
    const sandbox = setup();
    rmSync(join(sandbox.vault, ROUTES_NOTE));

    // #when
    const result = apply(sandbox, { items: [learning({ route: "Agent Skills" })] });

    // #then
    expect({ exitCode: result.exitCode, stderr: result.stderr, topic: readVaultFile(sandbox, TOPIC) }).toEqual({
      exitCode: 1,
      stderr: `brain-dump: Filing Plan rejected: Item 1 claims Route "Agent Skills", which the Routes note doesn't have\n`,
      topic: "# Agent Skills\n",
    });
  });

  test("refuses a routine Item filed into a note the plan creates", () => {
    // #given
    const sandbox = setup("Brain-Dump → [[Brain-Dump]]\n");
    const note = "Side Projects/Brain-Dump/Brain-Dump.md";

    // #when
    const result = apply(sandbox, { creates: [{ note, tags: [] }], items: [learning({ note, route: "Brain-Dump" })] });

    // #then
    expect({ exitCode: result.exitCode, stderr: result.stderr, created: existsSync(join(sandbox.vault, note)) }).toEqual({
      exitCode: 1,
      stderr: `brain-dump: Filing Plan rejected: Item 1 claims Route "Brain-Dump", but [[Brain-Dump]] doesn't exist yet\n`,
      created: false,
    });
  });

  test("refuses a routine Todo filed into a Todo Group the plan creates", () => {
    // #given
    const sandbox = setup("Lab → To-Do › Lab Website\n");
    const before = vaultState(sandbox);

    // #when
    const result = apply(sandbox, { items: [todo({ group: ["Lab Website"], route: "Lab" })], createGroups: [["Lab Website"]] });

    // #then
    expect({ exitCode: result.exitCode, stderr: result.stderr, vault: vaultState(sandbox) }).toEqual({
      exitCode: 1,
      stderr: `brain-dump: Filing Plan rejected: Item 2 claims Route "Lab", but To-Do › Lab Website doesn't exist yet in ${WEEK}\n`,
      vault: before,
    });
  });

  for (const route of ["", "  ", 7]) {
    test(`rejects ${JSON.stringify(route)} as a route`, () => {
      // #given
      const sandbox = setup();

      // #when
      const result = apply(sandbox, { items: [learning({ route })] });

      // #then
      expect({ exitCode: result.exitCode, shape: result.stderr.startsWith("brain-dump: invalid Filing Plan: expected {") }).toEqual({ exitCode: 2, shape: true });
    });
  }
});

describe("routine Items count toward the 8-note limit", () => {
  test("refuses 9 routine notes without confirmLarge", () => {
    // #given
    const sandbox = makeSandbox();
    const notes = Array.from({ length: 9 }, (_, n) => `Resources/Note ${n + 1}.md`);
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, `## Learnings\n${notes.map((_, n) => `- [ ] L${n + 1}.\n`).join("")}`));
    for (const note of notes) writeVaultFile(sandbox, note, "# Note\n");
    writeVaultFile(sandbox, ROUTES_NOTE, notes.map((_, n) => `k${n + 1} → [[Note ${n + 1}]]\n`).join(""));
    const items = notes.map((note, n) => ({ index: n + 1, outcome: "filed", note, lines: [`- L${n + 1}.`], route: `k${n + 1}` }));

    // #when
    const result = apply(sandbox, { items });

    // #then
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({
      exitCode: 1,
      stderr: "brain-dump: write refused: the plan writes 9 notes, more than 8, so it needs confirmLarge\n",
    });
  });
});
