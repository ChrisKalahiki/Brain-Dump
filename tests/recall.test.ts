import { describe, expect, test } from "bun:test";
import { DEV_ORIGIN, devOrigin, dumpFile, makeRepo, makeSandbox, run, writeVaultFile, type Sandbox } from "./harness.ts";

const GUARD_DUMP = "Inbox/Filed/2026-10-01 0900 Brain-Dump - guard.md";
const GUARD_ORIGIN = devOrigin("Brain-Dump", "2026-10-01T09:00", { tool: "Codex" });
const GUARD_LINE = "Session: Codex · `~/Projects/Brain-Dump` @ `main` · 2026-10-01 09:00 · [[Brain-Dump]]";
const DEV_LINE = "Session: Claude Code · `~/Projects/Brain-Dump` @ `main` · 2026-10-05 19:40 · [[Brain-Dump]]";
const RECALL_DUMP = "Inbox/2026-10-05 1940 Brain-Dump - recall.md";
const CHRONOS_DUMP = "Inbox/2026-10-03 1200 chronos - queues.md";
const CHRONOS_ORIGIN = devOrigin("chronos", "2026-10-03T12:00", { branch: null });
const CHRONOS_LINE = "Session: Claude Code · `~/Projects/chronos` · 2026-10-03 12:00 · [[chronos]]";
const TOPIC = "Side Projects/Brain-Dump.md";
const WEEK = "Research/Weekly Meetings/09-28-26 Weekly Update.md";
const FROM_GUARD = "\t- From [[2026-10-01 0900 Brain-Dump - guard|dump 10-01-26]]";
const FROM_GUARD_UPPER = "\t- From [[2026-10-01 0900 BRAIN-DUMP - GUARD|dump 10-01-26]]";

/** A filed Dump with its Learning and Decision in a Topic Note and its Todo in a Weekly Note, an unfiled Dump with a dropped Item, another project's Dump, and a note outside the allowlist. */
function seedVault(sandbox: Sandbox): void {
  writeVaultFile(
    sandbox,
    GUARD_DUMP,
    dumpFile(GUARD_ORIGIN, "## Learnings\n- [x] Codex hooks need a trust step.\n\n## Decisions\n- [x] The guard fails closed.\n\t- Why: a hook bug must not open the Vault.\n\n## Todos\n- [x] #todo Ship the Codex guard.\n- [-] #todo Port the guard to Cursor.\n"),
  );
  writeVaultFile(sandbox, TOPIC, `# Brain-Dump\n- Codex hooks need a trust step.\n${FROM_GUARD}\n- The guard fails closed.\n\t- Why: a hook bug must not open the Vault.\n${FROM_GUARD}\n- A hand-written guard thought.\n- Keep the guard in one binary.\n\t- Why: one install step.\n`);
  writeVaultFile(sandbox, WEEK, "# To-Do: #todo\n- Brain Dump\n\t- [ ] Ship the Codex guard. #todo\n");
  writeVaultFile(sandbox, RECALL_DUMP, dumpFile(DEV_ORIGIN, "## Learnings\n- [ ] Recall ranks guard hits by count, guard first.\n- [-] Recall could use an index for the guard.\n"));
  writeVaultFile(sandbox, CHRONOS_DUMP, dumpFile(CHRONOS_ORIGIN, "## Learnings\n- [ ] Job queues need a guard against double runs.\n"));
  writeVaultFile(sandbox, "Private/Journal.md", `- The guard is personal.\n${FROM_GUARD}\n`);
}

const GUARD_LEARNING = { note: TOPIC, kind: "learning", text: "Codex hooks need a trust step.", why: null, unfiled: false, dump: GUARD_DUMP, origin: GUARD_LINE };
const GUARD_DECISION = { note: TOPIC, kind: "decision", text: "The guard fails closed.", why: "a hook bug must not open the Vault.", unfiled: false, dump: GUARD_DUMP, origin: GUARD_LINE };
const GUARD_TODO = { note: WEEK, kind: "todo", text: "[ ] Ship the Codex guard. #todo", why: null, unfiled: false, dump: GUARD_DUMP, origin: GUARD_LINE };
const HAND_DECISION = { note: TOPIC, kind: "decision", text: "Keep the guard in one binary.", why: "one install step.", unfiled: false, dump: null, origin: null };
const RECALL_LEARNING = { note: RECALL_DUMP, kind: "learning", text: "Recall ranks guard hits by count, guard first.", why: null, unfiled: true, dump: RECALL_DUMP, origin: DEV_LINE };
const CHRONOS_LEARNING = { note: CHRONOS_DUMP, kind: "learning", text: "Job queues need a guard against double runs.", why: null, unfiled: true, dump: CHRONOS_DUMP, origin: CHRONOS_LINE };

function recall(sandbox: Sandbox, args: string[], cwd?: string) {
  const result = run(sandbox, ["recall", ...args], { cwd });
  return result.exitCode === 0 ? JSON.parse(result.stdout) : result;
}

/** A term Recall's Items, without its Sections. */
function recallItems(sandbox: Sandbox, terms: string[]) {
  const { results, more } = recall(sandbox, terms);
  return { results, more };
}

describe("brain-dump recall <terms…>", () => {
  test("ranks matching Items in the allowlist by hits, then newest Dump, then note path, leaving out dropped Items", () => {
    // #given
    const sandbox = makeSandbox();
    seedVault(sandbox);

    // #when
    const result = recallItems(sandbox, ["GUARD"]);

    // #then
    expect(result).toEqual({ results: [RECALL_LEARNING, CHRONOS_LEARNING, GUARD_TODO, GUARD_DECISION, HAND_DECISION], more: 0 });
  });

  test("counts a hit for each term found, in the text or the Why, not for repeats", () => {
    // #given
    const sandbox = makeSandbox();
    seedVault(sandbox);
    writeVaultFile(sandbox, RECALL_DUMP, dumpFile(DEV_ORIGIN, "## Learnings\n- [ ] A hook, a hook, a hook.\n"));

    // #when
    const result = recallItems(sandbox, ["hook", "trust"]);

    // #then
    expect(result).toEqual({ results: [GUARD_LEARNING, { ...RECALL_LEARNING, text: "A hook, a hook, a hook." }, GUARD_DECISION], more: 0 });
  });

  test("caps results at 20 and counts the rest in more", () => {
    // #given
    const sandbox = makeSandbox();
    const learnings = Array.from({ length: 23 }, (_, n) => `- [ ] Fact ${n} about caching.`).join("\n");
    writeVaultFile(sandbox, RECALL_DUMP, dumpFile(DEV_ORIGIN, `## Learnings\n${learnings}\n`));

    // #when
    const result = recall(sandbox, ["caching"]);

    // #then
    expect([result.results.length, result.more]).toEqual([20, 3]);
  });
});

const CHRONOS = "Side Projects/Chronos.md";
const QUEUES = "Research/Main Notes/Queues.md";

/** "queue" in three of four Sections, "backoff" in one. */
function seedSections(sandbox: Sandbox): void {
  writeVaultFile(sandbox, CHRONOS, "# Chronos\n- The queue runs jobs.\n## Retries\n- Retries wait with backoff.\n## Workers\n- Each worker takes from the queue.\n");
  writeVaultFile(sandbox, QUEUES, "# Queues\n- A queue holds jobs in order.\n");
}

function recallSections(sandbox: Sandbox, terms: string[]) {
  const { sections, moreSections } = recall(sandbox, terms);
  return { sections, moreSections };
}

describe("brain-dump recall <terms…> Sections", () => {
  test("ranks Sections by BM25, so a rare term outranks a common one, then by note path and line", () => {
    // #given
    const sandbox = makeSandbox();
    seedSections(sandbox);

    // #when
    const result = recallSections(sandbox, ["queue", "backoff"]);

    // #then
    expect(result).toEqual({
      sections: [
        { note: CHRONOS, section: "[[Chronos#Chronos#Retries]]", score: 1.179, bullets: 1, lines: 1 },
        { note: CHRONOS, section: "[[Chronos#Chronos]]", score: 0.381, bullets: 3, lines: 3 },
        { note: QUEUES, section: "[[Queues#Queues]]", score: 0.349, bullets: 1, lines: 1 },
        { note: CHRONOS, section: "[[Chronos#Chronos#Workers]]", score: 0.349, bullets: 1, lines: 1 },
      ],
      moreSections: 0,
    });
  });

  test("matches a Section by its ancestors' heading names", () => {
    // #given
    const sandbox = makeSandbox();
    seedSections(sandbox);

    // #when
    const { sections }: { sections: { section: string }[] } = recall(sandbox, ["Chronos"]);

    // #then
    expect(sections.map(({ section }) => section)).toEqual(["[[Chronos#Chronos]]", "[[Chronos#Chronos#Retries]]", "[[Chronos#Chronos#Workers]]"]);
  });

  test("finds Weekly Note Sections but not Dumps, Briefings or notes outside the allowlist", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, WEEK, "# Notes\n- Talked about the scheduler.\n");
    writeVaultFile(sandbox, RECALL_DUMP, dumpFile(DEV_ORIGIN, "## Learnings\n- [ ] The scheduler drifts.\n"));
    writeVaultFile(sandbox, "Research/Briefings/Daily/2026-10-26 Daily Briefing.md", "# Daily Briefing\n- Scheduler news.\n");
    writeVaultFile(sandbox, "Private/Journal.md", "# Journal\n- Scheduler thoughts.\n");

    // #when
    const { sections }: { sections: { note: string }[] } = recall(sandbox, ["scheduler"]);

    // #then
    expect(sections.map(({ note }) => note)).toEqual([WEEK]);
  });

  test("leaves filed lines out of a Section's text", () => {
    // #given
    const sandbox = makeSandbox();
    seedVault(sandbox);

    // #when
    const result = recallSections(sandbox, ["trust"]);

    // #then
    expect(result).toEqual({ sections: [], moreSections: 0 });
  });

  test("caps Sections at 10 and counts the rest in moreSections", () => {
    // #given
    const sandbox = makeSandbox();
    const headings = Array.from({ length: 13 }, (_, n) => `## Part ${n}\n- Notes on caching.`).join("\n");
    writeVaultFile(sandbox, CHRONOS, `# Chronos\n${headings}\n`);

    // #when
    const { sections, moreSections } = recall(sandbox, ["caching"]);

    // #then
    expect([sections.length, moreSections]).toEqual([10, 3]);
  });
});

describe("brain-dump recall provenance", () => {
  test("leaves a filed Todo's Dump out when two Dumps filed the same text", () => {
    // #given
    const sandbox = makeSandbox();
    seedVault(sandbox);
    writeVaultFile(sandbox, "Inbox/Filed/2026-10-02 0900 Brain-Dump - again.md", dumpFile(GUARD_ORIGIN, "## Todos\n- [x] #todo Ship the Codex guard.\n"));

    // #when
    const result = recallItems(sandbox, ["Ship"]);

    // #then
    expect(result).toEqual({ results: [{ ...GUARD_TODO, dump: null, origin: null }], more: 0 });
  });

  test("follows a backlink to its Dump whatever its case, as Obsidian does", () => {
    // #given
    const sandbox = makeSandbox();
    seedVault(sandbox);
    writeVaultFile(sandbox, TOPIC, `# Brain-Dump\n- Codex hooks need a trust step.\n${FROM_GUARD_UPPER}\n`);

    // #when
    const result = recallItems(sandbox, ["trust"]);

    // #then
    expect(result).toEqual({ results: [GUARD_LEARNING], more: 0 });
  });
});

describe("brain-dump recall --project", () => {
  test("returns the named project's Items, newest first, then by note path", () => {
    // #given
    const sandbox = makeSandbox();
    seedVault(sandbox);

    // #when
    const result = recall(sandbox, ["--project", "Brain-Dump"]);

    // #then
    expect(result).toEqual({ results: [RECALL_LEARNING, GUARD_TODO, GUARD_LEARNING, GUARD_DECISION], more: 0 });
  });

  test("defaults to the current repo's project", () => {
    // #given
    const sandbox = makeSandbox();
    seedVault(sandbox);
    const repo = makeRepo(sandbox, "chronos", "main");

    // #when
    const result = recall(sandbox, ["--project"], repo);

    // #then
    expect(result).toEqual({ results: [CHRONOS_LEARNING], more: 0 });
  });
});

describe("brain-dump recall --links", () => {
  test("returns each line in the allowlist that links to the note, whatever the alias or heading", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, "Side Projects/Chronos.md", "# Chronos\nSee [[Job Queues]] and [[Scheduling]].\n");
    writeVaultFile(sandbox, "Research/Main Notes/Queues.md", "- Builds on [[Side Projects/Job Queues#Retries|retries]]\n- unrelated [[Job Queues 2]]\n");
    writeVaultFile(sandbox, "Private/Journal.md", "[[Job Queues]]\n");

    // #when
    const result = recall(sandbox, ["--links", "[[Job Queues]]"]);

    // #then
    expect(result).toEqual({
      links: [
        { note: "Research/Main Notes/Queues.md", line: "- Builds on [[Side Projects/Job Queues#Retries|retries]]" },
        { note: "Side Projects/Chronos.md", line: "See [[Job Queues]] and [[Scheduling]]." },
      ],
    });
  });
});

describe("brain-dump recall modes", () => {
  const usage = "brain-dump: recall takes exactly one of <terms…>, --project [name] or --links [[Note]]\n";

  test.each([
    ["no mode", []],
    ["terms with --project", ["guard", "--project", "x"]],
    ["--project with --links", ["--project", "--links", "[[x]]"]],
  ])("rejects %s", (_, args) => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = run(sandbox, ["recall", ...args]);

    // #then
    expect([result.exitCode, result.stderr]).toEqual([2, usage]);
  });
});
