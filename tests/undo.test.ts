import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEV_ORIGIN as ORIGIN, dumpFile, makeSandbox, readVaultFile, run, WEEKLY_TEMPLATE, writeConfig, writeVaultFile, type Sandbox } from "./harness.ts";

const DUMP = "Inbox/2026-10-05 1940 Brain-Dump - filing.md";
const FILED = "Inbox/Filed/2026-10-05 1940 Brain-Dump - filing.md";
const OTHER_DUMP = "Inbox/2026-10-05 2000 Brain-Dump - other.md";
const WEEK = "Research/Weekly Meetings/10-05-26 Weekly Update.md";
const ROUTES = "Inbox/Filing Routes.md";
const APPLIED_AT = "2026-10-05T19:40:00Z";
const LATER = "2026-10-05T20:00:00Z";
const UNDONE_AT = "2026-10-05T21:00:00Z";

type Snapshot = Record<string, string>;

function vaultFiles(sandbox: Sandbox): Snapshot {
  const files = readdirSync(sandbox.vault, { recursive: true, encoding: "utf8" }).filter((name) => !name.startsWith(".obsidian") && name.endsWith(".md"));
  return Object.fromEntries(files.sort().map((name) => [name, readVaultFile(sandbox, name)]));
}

function runsFolder(sandbox: Sandbox): string {
  return join(sandbox.home, ".local", "state", "brain-dump", "runs");
}

function listRuns(sandbox: Sandbox): { id: string; command: string; label: string; status: string }[] {
  return JSON.parse(run(sandbox, ["runs"], { now: UNDONE_AT }).stdout);
}

function runId(sandbox: Sandbox, label: string): string {
  const found = listRuns(sandbox).find((summary) => summary.label === label);
  if (found === undefined) throw new Error(`no Run labelled ${label}`);
  return found.id;
}

/** Files a Dump: appends to an existing Weekly Note, creates the Routes note, and moves the Dump to Inbox/Filed. */
function fileDump(sandbox: Sandbox): { before: Snapshot; id: string } {
  writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Todos\n- [ ] #todo Ship it.\n"));
  writeVaultFile(sandbox, WEEK, WEEKLY_TEMPLATE);
  const before = vaultFiles(sandbox);
  const plan = {
    dump: DUMP,
    items: [{ index: 1, outcome: "filed", note: WEEK, section: "# To-Do:", lines: ["- [ ] Ship it. #todo"] }],
    inserts: [],
    routes: [{ key: "Brain-Dump", title: "Brain-Dump" }],
  };
  const result = run(sandbox, ["apply"], { stdin: JSON.stringify(plan), now: APPLIED_AT });
  if (result.exitCode !== 0) throw new Error(result.stderr);
  return { before, id: runId(sandbox, "2026-10-05 1940 Brain-Dump - filing") };
}

function undo(sandbox: Sandbox, id: string, ...flags: string[]) {
  const result = run(sandbox, ["undo", id, ...flags], { now: UNDONE_AT });
  return { ...result, report: result.exitCode === 0 ? JSON.parse(result.stdout) : undefined };
}

const FILED_DUMP_ACTIONS = [
  { path: WEEK, action: "restore" },
  { path: ROUTES, action: "delete" },
  { path: DUMP, action: "restore" },
  { path: FILED, action: "delete" },
];

describe("brain-dump undo", () => {
  test("without --confirm, prints what it would do and writes nothing", () => {
    // #given
    const sandbox = makeSandbox();
    const { id } = fileDump(sandbox);
    const after = vaultFiles(sandbox);

    // #when
    const result = undo(sandbox, id);

    // #then
    expect({ exitCode: result.exitCode, report: result.report, vault: vaultFiles(sandbox), runs: listRuns(sandbox).length }).toEqual({
      exitCode: 0,
      report: { undoes: id, label: "2026-10-05 1940 Brain-Dump - filing", confirmed: false, files: FILED_DUMP_ACTIONS },
      vault: after,
      runs: 1,
    });
  });

  test("with --confirm, restores every file exactly, deletes created files and moves the Dump back", () => {
    // #given
    const sandbox = makeSandbox();
    const { before, id } = fileDump(sandbox);

    // #when
    const result = undo(sandbox, id, "--confirm");

    // #then
    expect({ exitCode: result.exitCode, report: result.report, vault: vaultFiles(sandbox), runs: listRuns(sandbox) }).toEqual({
      exitCode: 0,
      report: { undoes: id, label: "2026-10-05 1940 Brain-Dump - filing", confirmed: true, files: FILED_DUMP_ACTIONS, run: expect.stringMatching(/^20261005-210000-[0-9a-f]{4}$/) },
      vault: before,
      runs: [
        expect.objectContaining({ id: result.report?.run, command: "undo", label: "undo 2026-10-05 1940 Brain-Dump - filing", status: "applied" }),
        expect.objectContaining({ id, command: "apply", status: "undone" }),
      ],
    });
  });

  test("undoing an undo works as redo", () => {
    // #given
    const sandbox = makeSandbox();
    const { id } = fileDump(sandbox);
    const filed = vaultFiles(sandbox);
    const undone = undo(sandbox, id, "--confirm");

    // #when
    const result = run(sandbox, ["undo", undone.report.run, "--confirm"], { now: "2026-10-05T22:00:00Z" });

    // #then
    expect({ exitCode: result.exitCode, stderr: result.stderr, vault: vaultFiles(sandbox), statuses: listRuns(sandbox).map(({ command, status }) => [command, status]) }).toEqual({
      exitCode: 0,
      stderr: "",
      vault: filed,
      statuses: [
        ["undo", "applied"],
        ["undo", "undone"],
        ["apply", "applied"],
      ],
    });
  });

  test("after an undo of a redo, the original Run is marked undone again", () => {
    // #given
    const sandbox = makeSandbox();
    const { before, id } = fileDump(sandbox);
    const undone = undo(sandbox, id, "--confirm");
    const redone = run(sandbox, ["undo", undone.report.run, "--confirm"], { now: "2026-10-05T22:00:00Z" });

    // #when
    const result = run(sandbox, ["undo", JSON.parse(redone.stdout).run, "--confirm"], { now: "2026-10-05T23:00:00Z" });

    // #then
    expect({ exitCode: result.exitCode, vault: vaultFiles(sandbox), statuses: listRuns(sandbox).map(({ command, status }) => [command, status]) }).toEqual({
      exitCode: 0,
      vault: before,
      statuses: [
        ["undo", "applied"],
        ["undo", "undone"],
        ["undo", "applied"],
        ["apply", "undone"],
      ],
    });
  });

  test("refuses, naming each file, when files changed since the Run", () => {
    // #given
    const sandbox = makeSandbox();
    const { id } = fileDump(sandbox);
    writeVaultFile(sandbox, OTHER_DUMP, dumpFile(ORIGIN, "## Todos\n- [ ] #todo Later.\n"));
    const later = { dump: OTHER_DUMP, items: [{ index: 1, outcome: "filed", note: WEEK, section: "# To-Do:", lines: ["- [ ] Later. #todo"] }], inserts: [] };
    run(sandbox, ["apply"], { stdin: JSON.stringify(later), now: LATER });
    const laterId = runId(sandbox, "2026-10-05 2000 Brain-Dump - other");
    writeFileSync(join(sandbox.vault, ROUTES), `${readVaultFile(sandbox, ROUTES)}- edited by hand\n`);
    const changed = vaultFiles(sandbox);

    // #when
    const result = undo(sandbox, id, "--confirm");

    // #then
    expect({ exitCode: result.exitCode, stderr: result.stderr, vault: vaultFiles(sandbox) }).toEqual({
      exitCode: 1,
      stderr: [
        `brain-dump: cannot undo run ${id}, because files changed since it:`,
        `  ${WEEK}: undo run ${laterId} first`,
        `  ${ROUTES}: changed outside Brain-Dump since 2026-10-05T19:40:00.000Z`,
        "",
      ].join("\n"),
      vault: changed,
    });
  });

  test("names the later Run's time when a file changed outside Brain-Dump after it", () => {
    // #given
    const sandbox = makeSandbox();
    const { id } = fileDump(sandbox);
    writeVaultFile(sandbox, OTHER_DUMP, dumpFile(ORIGIN, "## Todos\n- [ ] #todo Later.\n"));
    run(sandbox, ["apply"], { stdin: JSON.stringify({ dump: OTHER_DUMP, items: [{ index: 1, outcome: "filed", note: WEEK, section: "# To-Do:", lines: ["- [ ] Later. #todo"] }], inserts: [] }), now: LATER });
    writeFileSync(join(sandbox.vault, WEEK), `${readVaultFile(sandbox, WEEK)}- edited by hand\n`);

    // #when
    const result = undo(sandbox, id);

    // #then
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({
      exitCode: 1,
      stderr: `brain-dump: cannot undo run ${id}, because files changed since it:\n  ${WEEK}: changed outside Brain-Dump since 2026-10-05T20:00:00.000Z\n`,
    });
  });

  test("refuses when the Run's Vault isn't the current Vault", () => {
    // #given
    const sandbox = makeSandbox();
    const { id } = fileDump(sandbox);
    const other = join(sandbox.home, "Other Vault");
    writeVaultFile({ ...sandbox, vault: other }, ".obsidian/app.json", "{}");
    writeConfig(sandbox, `vault = ${other}\n`);

    // #when
    const result = undo(sandbox, id, "--confirm");

    // #then
    expect({ exitCode: result.exitCode, stderr: result.stderr, filed: existsSync(join(sandbox.vault, FILED)) }).toEqual({
      exitCode: 1,
      stderr: `brain-dump: cannot undo run ${id}: it was made in the Vault at ${sandbox.vault}, not the current Vault at ${other}\n`,
      filed: true,
    });
  });

  test("a crashed pending Run is undoable, skipping files still at their before-hash", () => {
    // #given
    const sandbox = makeSandbox();
    const { before, id } = fileDump(sandbox);
    const journalPath = join(runsFolder(sandbox), id, "run.json");
    writeFileSync(journalPath, readFileSync(journalPath, "utf8").replace('"status": "applied"', '"status": "pending"'));
    writeFileSync(join(sandbox.vault, WEEK), WEEKLY_TEMPLATE);

    // #when
    const result = undo(sandbox, id, "--confirm");

    // #then
    expect({ exitCode: result.exitCode, files: result.report?.files, vault: vaultFiles(sandbox) }).toEqual({
      exitCode: 0,
      files: [{ path: WEEK, action: "skip" }, ...FILED_DUMP_ACTIONS.slice(1)],
      vault: before,
    });
  });

  test("is all-or-nothing: a failed write leaves every file as the Run left it", () => {
    // #given
    const sandbox = makeSandbox();
    const { id } = fileDump(sandbox);
    const after = vaultFiles(sandbox);
    const filedFolder = join(sandbox.vault, "Inbox", "Filed");
    chmodSync(filedFolder, 0o555);

    // #when
    const result = undo(sandbox, id, "--confirm");
    chmodSync(filedFolder, 0o755);

    // #then
    expect({ exitCode: result.exitCode, stderr: result.stderr, vault: vaultFiles(sandbox), runs: listRuns(sandbox).map(({ status }) => status) }).toEqual({
      exitCode: 1,
      stderr: "brain-dump: could not write to the Vault: permission denied\n",
      vault: after,
      runs: ["applied"],
    });
  });

  test("refuses a Run that is already undone", () => {
    // #given
    const sandbox = makeSandbox();
    const { id } = fileDump(sandbox);
    undo(sandbox, id, "--confirm");

    // #when
    const result = undo(sandbox, id);

    // #then
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({
      exitCode: 1,
      stderr: `brain-dump: nothing to undo: every file of run ${id} is already as it was before it\n`,
    });
  });

  test("refuses a Run id that isn't in the run store", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = undo(sandbox, "../../../etc");

    // #then
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 1, stderr: "brain-dump: no run ../../../etc on this machine\n" });
  });

  test("needs a Run id", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = run(sandbox, ["undo"]);

    // #then
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 2, stderr: "brain-dump: undo needs a run id\n" });
  });
});
