import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join, relative } from "node:path";
import { DEV_ORIGIN as ORIGIN, DUMP_AT, dumpFile, makeSandbox, readVaultFile, run, WEEKLY_TEMPLATE, writeVaultFile, type Sandbox, pinned } from "./harness.ts";

const DUMP = "Inbox/2026-10-05 1940 Brain-Dump - filing.md";
const FILED = "Inbox/Filed/2026-10-05 1940 Brain-Dump - filing.md";
const WEEK = "Research/Weekly Meetings/10-05-26 Weekly Update.md";
const NOW = "2026-10-05T19:40:00Z";

function runsFolder(sandbox: Sandbox): string {
  return join(sandbox.home, ".local", "state", "brain-dump", "runs");
}

function journals(sandbox: Sandbox): Record<string, unknown>[] {
  const folder = runsFolder(sandbox);
  if (!existsSync(folder)) return [];
  return readdirSync(folder).map((id) => JSON.parse(readFileSync(join(folder, id, "run.json"), "utf8")));
}

function beforeCopies(sandbox: Sandbox, id: string): Record<string, string> {
  const folder = join(runsFolder(sandbox), id, "before");
  if (!existsSync(folder)) return {};
  const files = readdirSync(folder, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
  return Object.fromEntries(files.map((entry) => [relative(folder, join(entry.parentPath, entry.name)), readFileSync(join(entry.parentPath, entry.name), "utf8")]));
}

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function writeDump(sandbox: Sandbox, slug: string, now: string) {
  return run(sandbox, ["write-dump", "--tool", "ChatGPT", "--slug", slug, "--at", DUMP_AT], { stdin: "## Todos\n- [ ] #todo A.\n", now });
}

function listRuns(sandbox: Sandbox, now = NOW) {
  return JSON.parse(run(sandbox, ["runs"], { now }).stdout);
}

describe("every gateway commit is recorded as a Run", () => {
  test("an apply journals each file it changed, with hashes and a copy of every file that existed before", () => {
    // #given
    const sandbox = makeSandbox();
    const dump = dumpFile(ORIGIN, "## Todos\n- [ ] #todo Ship it.\n");
    writeVaultFile(sandbox, DUMP, dump);
    writeVaultFile(sandbox, WEEK, WEEKLY_TEMPLATE);
    const plan = {
      dump: DUMP,
      items: [{ index: 1, outcome: "filed", note: WEEK, section: "# To-Do:" }],
      routes: [{ key: "Brain-Dump", title: "Brain-Dump" }],
    };

    // #when
    const result = run(sandbox, ["apply"], { stdin: JSON.stringify(pinned(sandbox, plan)), now: NOW });

    // #then
    const recorded = journals(sandbox);
    expect({ exitCode: result.exitCode, journals: recorded, before: beforeCopies(sandbox, String(recorded[0]?.id)) }).toEqual({
      exitCode: 0,
      journals: [
        {
          id: expect.stringMatching(/^20261005-194000-[0-9a-f]{4}$/),
          time: "2026-10-05T19:40:00.000Z",
          command: "apply",
          label: "2026-10-05 1940 Brain-Dump - filing",
          host: hostname(),
          vault: sandbox.vault,
          status: "applied",
          files: [
            { operation: "append", path: WEEK, before: sha256(WEEKLY_TEMPLATE), after: sha256(readVaultFile(sandbox, WEEK)) },
            { operation: "create", path: "Inbox/Filing Routes.md", before: null, after: sha256(readVaultFile(sandbox, "Inbox/Filing Routes.md")) },
            { operation: "move", from: DUMP, to: FILED, before: sha256(dump), after: sha256(readVaultFile(sandbox, FILED)) },
          ],
        },
      ],
      before: { [DUMP]: dump, [WEEK]: WEEKLY_TEMPLATE },
    });
  });

  test("a Dump filed but not finished is journaled as a checkbox change", () => {
    // #given
    const sandbox = makeSandbox();
    const dump = dumpFile(ORIGIN, "## Todos\n- [ ] #todo A.\n- [ ] #todo B.\n");
    writeVaultFile(sandbox, DUMP, dump);

    // #when
    const result = run(sandbox, ["apply"], { stdin: JSON.stringify(pinned(sandbox, { dump: DUMP, items: [{ index: 1, outcome: "dropped" }] })), now: NOW });

    // #then
    expect({ exitCode: result.exitCode, files: journals(sandbox).map(({ files }) => files) }).toEqual({
      exitCode: 0,
      files: [[{ operation: "checkbox", path: DUMP, before: sha256(dump), after: sha256(readVaultFile(sandbox, DUMP)) }]],
    });
  });

  test("a write-dump journals the new Dump, with nothing in before/", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = writeDump(sandbox, "first", NOW);

    // #then
    const path = relative(sandbox.vault, result.stdout.trim());
    const [journal] = journals(sandbox);
    expect({ journal, before: beforeCopies(sandbox, String(journal?.id)) }).toEqual({
      journal: {
        id: expect.stringMatching(/^20261005-194000-[0-9a-f]{4}$/),
        time: "2026-10-05T19:40:00.000Z",
        command: "write-dump",
        label: "2026-10-05 1940 ChatGPT - first",
        host: hostname(),
        vault: sandbox.vault,
        status: "applied",
        files: [{ operation: "create", path, before: null, after: sha256(readVaultFile(sandbox, path)) }],
      },
      before: {},
    });
  });

  test("a refused plan records no Run", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Todos\n- [ ] #todo A.\n"));
    writeVaultFile(sandbox, "Journal/Today.md", "");
    writeVaultFile(sandbox, WEEK, WEEKLY_TEMPLATE);

    // #when
    const result = run(sandbox, ["apply"], { stdin: JSON.stringify(pinned(sandbox, { dump: DUMP, items: [{ index: 1, outcome: "filed", note: "Journal/Today.md" }] })), now: NOW });

    // #then
    expect({ exitCode: result.exitCode, journals: journals(sandbox) }).toEqual({ exitCode: 1, journals: [] });
  });

  test("when the Run can't be recorded, nothing in the Vault is written", () => {
    // #given
    const sandbox = makeSandbox();
    const dump = dumpFile(ORIGIN, "## Todos\n- [ ] #todo A.\n");
    writeVaultFile(sandbox, DUMP, dump);
    mkdirSync(join(sandbox.home, ".local", "state"), { recursive: true });
    writeFileSync(join(sandbox.home, ".local", "state", "brain-dump"), "not a folder");

    // #when
    const result = run(sandbox, ["apply"], { stdin: JSON.stringify(pinned(sandbox, { dump: DUMP, items: [{ index: 1, outcome: "dropped" }] })), now: NOW });

    // #then
    expect({
      exitCode: result.exitCode,
      stderr: result.stderr.startsWith(`brain-dump: cannot record the Run in ${runsFolder(sandbox)}: `),
      dump: readVaultFile(sandbox, DUMP),
      filed: existsSync(join(sandbox.vault, FILED)),
    }).toEqual({ exitCode: 1, stderr: true, dump, filed: false });
  });

  test("Runs older than 90 days are pruned when a new Run starts", () => {
    // #given
    const sandbox = makeSandbox();
    writeDump(sandbox, "old", "2026-01-01T00:00:00Z");
    writeDump(sandbox, "recent", "2026-01-03T00:00:00Z");

    // #when
    const result = writeDump(sandbox, "new", "2026-04-02T00:00:00Z");

    // #then
    expect({ exitCode: result.exitCode, labels: listRuns(sandbox).map(({ label }: { label: string }) => label) }).toEqual({
      exitCode: 0,
      labels: ["2026-10-05 1940 ChatGPT - new", "2026-10-05 1940 ChatGPT - recent"],
    });
  });
});

describe("brain-dump runs", () => {
  test("prints the 20 latest Runs, newest first", () => {
    // #given
    const sandbox = makeSandbox();
    for (let minute = 10; minute <= 30; minute++) writeDump(sandbox, `m${minute}`, `2026-10-05T19:${minute}:00Z`);

    // #when
    const runs = listRuns(sandbox);

    // #then
    expect({ count: runs.length, newest: runs[0], oldest: runs.at(-1).label }).toEqual({
      count: 20,
      newest: {
        id: expect.stringMatching(/^20261005-193000-[0-9a-f]{4}$/),
        time: "2026-10-05T19:30:00.000Z",
        command: "write-dump",
        label: "2026-10-05 1940 ChatGPT - m30",
        files: 1,
        status: "applied",
      },
      oldest: "2026-10-05 1940 ChatGPT - m11",
    });
  });

  test("prints an empty list when there are no Runs", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = run(sandbox, ["runs"]);

    // #then
    expect({ exitCode: result.exitCode, runs: JSON.parse(result.stdout) }).toEqual({ exitCode: 0, runs: [] });
  });
});
