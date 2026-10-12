import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEV_ORIGIN, dumpFile, makeSandbox, ROUTES_NOTE, run, writeConfig, writeVaultFile, type Sandbox } from "./harness.ts";

const NOW = "2026-10-20T09:00";
const TOPIC = "Research/Main Notes/Agent Skills.md";
const PROJECT = "Side Projects/Brain-Dump/Brain-Dump.md";
const WEEK = "Research/Weekly Meetings/10-19-26 Weekly Update.md";
const FILED_DUMP = "Inbox/Filed/2026-10-01 0900 Brain-Dump - guard.md";
const FROM_FILED = "\t- From [[2026-10-01 0900 Brain-Dump - guard|dump 10-01-26]]";
const OPEN_BODY = "## Learnings\n- [ ] Codex reads skills from ~/.agents/skills.\n- [x] Hooks need a trust step.\n";
const DONE_BODY = "## Learnings\n- [x] Hooks need a trust step.\n";

function check(sandbox: Sandbox, args: string[] = ["--json"]) {
  return run(sandbox, ["check", ...args], { now: NOW });
}

function findings(sandbox: Sandbox) {
  return JSON.parse(check(sandbox).stdout);
}

function filedItems(count: number, label = "Fact"): string {
  return Array.from({ length: count }, (_, n) => `- ${label} ${n}.\n${FROM_FILED}\n`).join("");
}

/** A Vault with nothing to report: a filed Dump, the notes it was filed into, and a Route to one of them. */
function seedHealthyVault(sandbox: Sandbox): void {
  writeVaultFile(sandbox, FILED_DUMP, dumpFile(DEV_ORIGIN, DONE_BODY));
  writeVaultFile(sandbox, TOPIC, `# Agent Skills\n- Hooks need a trust step.\n${FROM_FILED}\n`);
  writeVaultFile(sandbox, WEEK, "# To-Do: #todo\n- [ ] Ship the guard. #todo\n# Notes:\n- Filed [[2026-10-01 0900 Brain-Dump - guard|Brain-Dump guard]]\n");
  writeVaultFile(sandbox, ROUTES_NOTE, "- Brain-Dump → [[Agent Skills]]\n- Dissertation → To-Do › Dissertation\n");
}

describe("brain-dump check on a healthy Vault", () => {
  test("prints an empty list and exits 0", () => {
    // #given
    const sandbox = makeSandbox();
    seedHealthyVault(sandbox);

    // #when
    const result = check(sandbox);

    // #then
    expect([result.exitCode, result.stdout]).toEqual([0, "[]\n"]);
  });

  test("says so in text", () => {
    // #given
    const sandbox = makeSandbox();
    seedHealthyVault(sandbox);

    // #when
    const result = check(sandbox, []);

    // #then
    expect([result.exitCode, result.stdout]).toEqual([0, "No Vault findings.\n"]);
  });
});

describe("brain-dump check findings", () => {
  test("reports a From or Filed backlink that doesn't resolve to a Dump", () => {
    // #given
    const sandbox = makeSandbox();
    seedHealthyVault(sandbox);
    writeVaultFile(sandbox, PROJECT, "# Brain-Dump\n- Gone.\n\t- From [[2026-09-01 0900 Brain-Dump - gone|dump 09-01-26]]\n");
    writeVaultFile(sandbox, WEEK, "# Notes:\n- Filed [[2026-09-02 0900 Brain-Dump - lost|Brain-Dump lost]]\n");

    // #when
    const result = findings(sandbox);

    // #then
    expect(result).toEqual([
      { kind: "Broken backlink", note: WEEK, detail: "line 2: [[2026-09-02 0900 Brain-Dump - lost]] is not a Dump", fix: "hand edit, or restore the Dump" },
      { kind: "Broken backlink", note: PROJECT, detail: "line 3: [[2026-09-01 0900 Brain-Dump - gone]] is not a Dump", fix: "hand edit, or restore the Dump" },
    ]);
  });

  test("reports a Route to a note that doesn't exist, but not a Route to a Todo Group", () => {
    // #given
    const sandbox = makeSandbox();
    seedHealthyVault(sandbox);
    writeVaultFile(sandbox, ROUTES_NOTE, "- Brain-Dump → [[Agent Skills]]\n- chronos → [[Chronos Main Note]]\n- Dissertation → To-Do › Dissertation\n");

    // #when
    const result = findings(sandbox);

    // #then
    expect(result).toEqual([{ kind: "Dead Route", note: ROUTES_NOTE, detail: "chronos → [[Chronos Main Note]] targets no note", fix: "edit the Routes note" }]);
  });

  test("reports a Dump with open Items more than 14 days past its date", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, "Inbox/2026-10-05 1940 Brain-Dump - old.md", dumpFile(DEV_ORIGIN, OPEN_BODY));
    writeVaultFile(sandbox, "Inbox/2026-10-06 1940 Brain-Dump - recent.md", dumpFile(DEV_ORIGIN, OPEN_BODY));

    // #when
    const result = findings(sandbox);

    // #then
    expect(result).toEqual([
      { kind: "Stale Dump", note: "Inbox/2026-10-05 1940 Brain-Dump - old.md", detail: "1 open Item, 15 days after its date", fix: "/file, or drop N in its Filing Plan" },
    ]);
  });

  test("reports a finished Dump left in the Inbox and a filed Dump still holding open Items", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, "Inbox/2026-10-18 0900 Brain-Dump - done.md", dumpFile(DEV_ORIGIN, DONE_BODY));
    writeVaultFile(sandbox, "Inbox/Filed/2026-10-18 1000 Brain-Dump - half.md", dumpFile(DEV_ORIGIN, OPEN_BODY));

    // #when
    const result = findings(sandbox);

    // #then
    expect(result).toEqual([
      { kind: "Stuck Dump", note: "Inbox/2026-10-18 0900 Brain-Dump - done.md", detail: "no open Items left, but still in Inbox", fix: "re-run /file, or move it by hand" },
      { kind: "Stuck Dump", note: "Inbox/Filed/2026-10-18 1000 Brain-Dump - half.md", detail: "1 open Item, but already in Inbox/Filed", fix: "re-run /file, or move it by hand" },
    ]);
  });

  test("reports a Topic Note with 40 filed Items and no Digest", () => {
    // #given
    const sandbox = makeSandbox();
    seedHealthyVault(sandbox);
    writeVaultFile(sandbox, TOPIC, `# Agent Skills\n${filedItems(40)}`);

    // #when
    const result = findings(sandbox);

    // #then
    expect(result).toEqual([{ kind: "Oversized note", note: TOPIC, detail: "40 filed Items and no Digest", fix: "/consolidate [[Agent Skills]]" }]);
  });

  test("counts a note's filed Items only after its latest Digest", () => {
    // #given
    const sandbox = makeSandbox();
    seedHealthyVault(sandbox);
    const digest = "> [!summary] Digest 10-10-26\n> - Facts.\n\n^digest-101026\n";
    writeVaultFile(sandbox, PROJECT, `# Brain-Dump\n${filedItems(5, "Old")}${digest}${filedItems(39)}`);
    writeVaultFile(sandbox, TOPIC, `# Agent Skills\n${filedItems(5, "Old")}${digest}${filedItems(40)}`);

    // #when
    const result = findings(sandbox);

    // #then
    expect(result).toEqual([{ kind: "Oversized note", note: TOPIC, detail: "40 filed Items since its latest Digest", fix: "/consolidate [[Agent Skills]]" }]);
  });

  test("never calls a Weekly Note oversized", () => {
    // #given
    const sandbox = makeSandbox();
    seedHealthyVault(sandbox);
    writeVaultFile(sandbox, WEEK, `# Notes:\n${filedItems(40)}`);

    // #when
    const result = findings(sandbox);

    // #then
    expect(result).toEqual([]);
  });

  test("reports a Decision filed twice even when its two Whys differ", () => {
    // #given
    const sandbox = makeSandbox();
    seedHealthyVault(sandbox);
    writeVaultFile(sandbox, TOPIC, `# Agent Skills\n- Fail closed.\n\t- Why: safety.\n${FROM_FILED}\n- Fail closed.\n\t- Why: simpler.\n${FROM_FILED}\n`);

    // #when
    const result = findings(sandbox);

    // #then
    expect(result).toEqual([{ kind: "Duplicate Item", note: TOPIC, detail: '"Fail closed." appears 2 times', fix: "remove by hand, or leave for the next Digest" }]);
  });

  test("reports Items repeated within one note, ignoring case, spacing, checkbox, #todo and the backlink", () => {
    // #given
    const sandbox = makeSandbox();
    seedHealthyVault(sandbox);
    writeVaultFile(sandbox, TOPIC, `# Agent Skills\n- Hooks need a trust step.\n${FROM_FILED}\n- hooks  need a TRUST step.\n\t- From [[2026-10-02 0900 Brain-Dump - again]]\n`);
    writeVaultFile(sandbox, "Inbox/Filed/2026-10-02 0900 Brain-Dump - again.md", dumpFile(DEV_ORIGIN, DONE_BODY));
    writeVaultFile(sandbox, WEEK, "# To-Do: #todo\n- [ ] Ship the guard. #todo\n- [x] #todo ship the guard.\n");

    // #when
    const result = findings(sandbox);

    // #then
    expect(result).toEqual([
      { kind: "Duplicate Item", note: TOPIC, detail: '"Hooks need a trust step." appears 2 times', fix: "remove by hand, or leave for the next Digest" },
      { kind: "Duplicate Item", note: WEEK, detail: '"[ ] Ship the guard. #todo" appears 2 times', fix: "remove by hand, or leave for the next Digest" },
    ]);
  });

  test.each([
    ["no frontmatter", `${DEV_ORIGIN}\n\n${OPEN_BODY}`, "no frontmatter"],
    ["no origin line", `---\ntags:\n  - dump\n---\n\n${OPEN_BODY}`, "no Session: origin line after the frontmatter"],
    ["an unparsable section", dumpFile(DEV_ORIGIN, "## Learnings\nloose text\n"), 'invalid Dump body: line 2 is not an Item: "loose text"'],
  ])("reports a Dump with %s as malformed", (_, contents, detail) => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, "Inbox/2026-10-18 0900 Brain-Dump - bad.md", contents);

    // #when
    const result = findings(sandbox);

    // #then
    expect(result).toEqual([{ kind: "Malformed Dump", note: "Inbox/2026-10-18 0900 Brain-Dump - bad.md", detail, fix: "hand edit" }]);
  });

  test("looks only inside the write allowlist", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, "Private/Journal.md", "- Secret.\n\t- From [[2026-09-01 0900 nowhere]]\n- Secret.\n\t- From [[2026-09-01 0900 nowhere]]\n");

    // #when
    const result = findings(sandbox);

    // #then
    expect(result).toEqual([]);
  });
});

describe("brain-dump check output", () => {
  test("prints one line per finding, grouped by kind, and exits 1", () => {
    // #given
    const sandbox = makeSandbox();
    seedHealthyVault(sandbox);
    writeVaultFile(sandbox, "Inbox/Filed/2026-10-18 1000 Brain-Dump - half.md", dumpFile(DEV_ORIGIN, OPEN_BODY));
    writeVaultFile(sandbox, "Inbox/2026-10-01 0900 Brain-Dump - old.md", dumpFile(DEV_ORIGIN, OPEN_BODY));
    writeVaultFile(sandbox, ROUTES_NOTE, "- chronos → [[Chronos]]\n");

    // #when
    const result = check(sandbox, []);

    // #then
    expect([result.exitCode, result.stdout]).toEqual([
      1,
      [
        "Dead Route · [[Filing Routes]] · chronos → [[Chronos]] targets no note → edit the Routes note",
        "Stale Dump · [[2026-10-01 0900 Brain-Dump - old]] · 1 open Item, 19 days after its date → /file, or drop N in its Filing Plan",
        "Stuck Dump · [[2026-10-18 1000 Brain-Dump - half]] · 1 open Item, but already in Inbox/Filed → re-run /file, or move it by hand",
        "",
      ].join("\n"),
    ]);
  });

  test("never writes to the Vault, not even the Inbox folder", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, TOPIC, `# Agent Skills\n${filedItems(40)}`);
    const before = readFileSync(join(sandbox.vault, TOPIC), "utf8");

    // #when
    check(sandbox);

    // #then
    expect([readdirSync(sandbox.vault).sort(), readFileSync(join(sandbox.vault, TOPIC), "utf8") === before]).toEqual([[".obsidian", "Research"], true]);
  });

  test("exits 2 when the Vault is missing", () => {
    // #given
    const sandbox = makeSandbox();
    writeConfig(sandbox, "vault = ~/Nowhere\n");

    // #when
    const result = check(sandbox);

    // #then
    expect([result.exitCode, result.stderr, existsSync(join(sandbox.home, "Nowhere"))]).toEqual([2, `brain-dump: Vault not found at ${join(sandbox.home, "Nowhere")}\n`, false]);
  });

  test("exits 2 with the reason when a note can't be read", () => {
    // #given
    const sandbox = makeSandbox();
    chmodSync(writeVaultFile(sandbox, TOPIC, "# Agent Skills\n"), 0o000);

    // #when
    const result = check(sandbox);

    // #then
    expect([result.exitCode, result.stderr]).toEqual([2, `brain-dump: cannot read ${join(sandbox.vault, TOPIC)}: permission denied\n`]);
  });

  test("exits 2 on an unknown option", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = check(sandbox, ["--fix"]);

    // #then
    expect(result.exitCode).toBe(2);
  });
});
