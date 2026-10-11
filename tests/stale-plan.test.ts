import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { DEV_ORIGIN as ORIGIN, dumpFile, makeSandbox, pinned, readVaultFile, ROUTES_NOTE, run, vaultFileHash, WEEKLY_TEMPLATE, writeVaultFile, type Sandbox } from "./harness.ts";

const DUMP = "Inbox/2026-10-05 1940 Brain-Dump - filing.md";
const FILED = "Inbox/Filed/2026-10-05 1940 Brain-Dump - filing.md";
const OTHER_DUMP = "Inbox/2026-10-05 2000 Brain-Dump - other.md";
const WEEK = "Research/Weekly Meetings/10-05-26 Weekly Update.md";
const TOPIC = "Research/Main Notes/Agent Skills.md";
const NEW_TOPIC = "Research/Main Notes/Bun.md";

function apply(sandbox: Sandbox, plan: unknown) {
  return run(sandbox, ["apply"], { stdin: JSON.stringify(plan) });
}

function fileTodo(index: number, line: string) {
  return { index, outcome: "filed", note: WEEK, section: "# To-Do:", lines: [line] };
}

function setup(): Sandbox {
  const sandbox = makeSandbox();
  writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Todos\n- [ ] #todo Ship it.\n- [ ] #todo Test it.\n"));
  writeVaultFile(sandbox, WEEK, WEEKLY_TEMPLATE);
  return sandbox;
}

describe("read commands report content hashes", () => {
  test("a hash is the first 16 hex characters of the SHA-256 of the file's exact bytes, CRLF and all", () => {
    // #given
    const sandbox = makeSandbox();
    const bytes = "---\r\ntags:\r\n  - LLMs\r\n---\r\n- café\r\n";
    writeVaultFile(sandbox, TOPIC, bytes);

    // #when
    const result = run(sandbox, ["list-notes"]);

    // #then
    expect(JSON.parse(result.stdout)[0].hash).toBe(createHash("sha256").update(Buffer.from(bytes, "utf8")).digest("hex").slice(0, 16));
  });

  test("list-dumps, weekly-note, todo-groups and routes each report the hash of the file they read", () => {
    // #given
    const sandbox = setup();
    writeVaultFile(sandbox, ROUTES_NOTE, "Brain-Dump → [[Brain-Dump]]\n");

    // #when
    const dumps = JSON.parse(run(sandbox, ["list-dumps"]).stdout);
    const weekly = JSON.parse(run(sandbox, ["weekly-note", "--date", "2026-10-08"]).stdout);
    const groups = JSON.parse(run(sandbox, ["todo-groups", "--date", "2026-10-08"]).stdout);
    const routes = JSON.parse(run(sandbox, ["routes"]).stdout);

    // #then
    const week = vaultFileHash(sandbox, WEEK);
    expect([dumps[0].hash, weekly.hash, groups.thisWeek.hash, routes.hash]).toEqual([vaultFileHash(sandbox, DUMP), week, week, vaultFileHash(sandbox, ROUTES_NOTE)]);
  });

  test("a Weekly Note or Routes note that doesn't exist yet has a null hash", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const weekly = JSON.parse(run(sandbox, ["weekly-note", "--date", "2026-10-08"]).stdout);
    const groups = JSON.parse(run(sandbox, ["todo-groups", "--date", "2026-10-08"]).stdout);
    const routes = JSON.parse(run(sandbox, ["routes"]).stdout);

    // #then
    expect([weekly.hash, groups.thisWeek.hash, routes]).toEqual([null, null, { hash: null, routes: [] }]);
  });
});

describe("brain-dump apply checks expect", () => {
  test("refuses a plan that writes an existing file with no expect entry for it, writing nothing", () => {
    // #given
    const sandbox = setup();
    const plan = { dump: DUMP, items: [fileTodo(1, "- [ ] Ship it. #todo")], inserts: [], expect: { [DUMP]: vaultFileHash(sandbox, DUMP) } };

    // #when
    const result = apply(sandbox, plan);

    // #then
    expect([result.exitCode, result.stderr, readVaultFile(sandbox, WEEK)]).toEqual([1, `brain-dump: Filing Plan rejected: expect has no hash for ${WEEK}\n`, WEEKLY_TEMPLATE]);
  });

  test("refuses the whole plan when files changed since they were read, naming every one and writing nothing", () => {
    // #given
    const sandbox = setup();
    writeVaultFile(sandbox, TOPIC, "- Skills\n");
    const plan = pinned(sandbox, {
      dump: DUMP,
      items: [fileTodo(1, "- [ ] Ship it. #todo"), { index: 2, outcome: "filed", note: TOPIC, lines: ["- Test it."] }],
      inserts: [],
    });
    const dump = readVaultFile(sandbox, DUMP);
    writeVaultFile(sandbox, WEEK, `${WEEKLY_TEMPLATE}- edited in Obsidian\n`);
    writeVaultFile(sandbox, TOPIC, "- Skills\r\n");

    // #when
    const result = apply(sandbox, plan);

    // #then
    expect([result.exitCode, result.stderr, readVaultFile(sandbox, DUMP)]).toEqual([1, `brain-dump: Filing Plan stale: ${WEEK} and ${TOPIC} changed since it was read\n`, dump]);
  });

  test("treats a pinned file that was deleted since it was read as changed", () => {
    // #given
    const sandbox = setup();
    const plan = pinned(sandbox, { dump: DUMP, items: [fileTodo(1, "- [ ] Ship it. #todo")], inserts: [] });
    rmSync(join(sandbox.vault, WEEK));

    // #when
    const result = apply(sandbox, plan);

    // #then
    expect(result.stderr).toBe(`brain-dump: Filing Plan stale: ${WEEK} changed since it was read\n`);
  });

  test("returns the hash of every file it wrote, which a later plan in the same run can pin", () => {
    // #given
    const sandbox = setup();
    writeVaultFile(sandbox, OTHER_DUMP, dumpFile(ORIGIN, "## Todos\n- [ ] #todo Later.\n"));
    const first = pinned(sandbox, {
      dump: DUMP,
      creates: [{ note: NEW_TOPIC, tags: [] }],
      items: [fileTodo(1, "- [ ] Ship it. #todo"), { index: 2, outcome: "filed", note: NEW_TOPIC, lines: ["- Test it."] }],
      inserts: [],
      routes: [{ key: "Brain-Dump", title: "Brain-Dump" }],
    });
    const otherDump = vaultFileHash(sandbox, OTHER_DUMP);

    // #when
    const { hashes } = JSON.parse(apply(sandbox, first).stdout);
    const onDisk = Object.fromEntries([NEW_TOPIC, ROUTES_NOTE, WEEK, FILED].map((path) => [path, vaultFileHash(sandbox, path)]));
    const second = apply(sandbox, { dump: OTHER_DUMP, items: [fileTodo(1, "- [ ] Later. #todo")], inserts: [], expect: { [OTHER_DUMP]: otherDump, [WEEK]: hashes[WEEK] } });

    // #then
    expect([hashes, second.exitCode]).toEqual([onDisk, 0]);
  });
});
