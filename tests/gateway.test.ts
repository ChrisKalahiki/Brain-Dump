import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DEV_ORIGIN as ORIGIN, dumpFile, makeSandbox, readVaultFile, run, WEEKLY_TEMPLATE, writeVaultFile, type Sandbox } from "./harness.ts";

const DUMP = "Inbox/2026-10-05 1940 Brain-Dump - filing.md";
const OTHER_DUMP = "Inbox/2026-10-04 1200 Brain-Dump - other.md";
const WEEK = "Research/Weekly Meetings/10-05-26 Weekly Update.md";
const JOURNAL = "Journal/2026-10-05.md";

function apply(sandbox: Sandbox, plan: unknown) {
  return run(sandbox, ["apply"], { stdin: JSON.stringify(plan) });
}

function stagedFiles(sandbox: Sandbox): string[] {
  return readdirSync(sandbox.vault, { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith(".brain-dump-tmp"));
}

function intoWeek(line: string) {
  return { note: WEEK, section: "# Notes:", lines: [line] };
}

describe("the write gateway refuses the whole plan, writing nothing", () => {
  const cases: [string, (sandbox: Sandbox) => unknown, string][] = [
    [
      "an insert into a note outside the write allowlist",
      () => ({ dump: DUMP, items: [{ index: 1, outcome: "dropped" }], inserts: [intoWeek("- kept"), { note: JOURNAL, lines: ["- leaked"] }] }),
      `${JOURNAL} is outside the write allowlist`,
    ],
    [
      "a new note outside the write allowlist",
      () => ({ dump: DUMP, creates: [{ note: "Journal/New.md", tags: [] }], items: [], inserts: [intoWeek("- kept"), { note: "Journal/New.md", lines: ["- leaked"] }] }),
      "Journal/New.md is outside the write allowlist",
    ],
    [
      "an insert into a note at the Vault root",
      (sandbox) => {
        writeVaultFile(sandbox, "Home.md", "# Home\n");
        return { dump: DUMP, items: [], inserts: [intoWeek("- kept"), { note: "Home.md", lines: ["- leaked"] }] };
      },
      "Home.md is outside the write allowlist",
    ],
    [
      "an insert into another Dump in the Inbox",
      (sandbox) => {
        writeVaultFile(sandbox, OTHER_DUMP, dumpFile(ORIGIN, "## Todos\n- [ ] #todo Other.\n"));
        return { dump: DUMP, items: [], inserts: [intoWeek("- kept"), { note: OTHER_DUMP, lines: ["- leaked"] }] };
      },
      `${OTHER_DUMP} is in the Inbox, which a plan changes only through its own Dump and the Routes note`,
    ],
    [
      "an insert into a note in Inbox/Filed",
      (sandbox) => {
        writeVaultFile(sandbox, "Inbox/Filed/Old.md", "# Old\n");
        return { dump: DUMP, items: [], inserts: [intoWeek("- kept"), { note: "Inbox/Filed/Old.md", lines: ["- leaked"] }] };
      },
      "Inbox/Filed/Old.md is in the Inbox, which a plan changes only through its own Dump and the Routes note",
    ],
  ];

  for (const [name, makePlan, reason] of cases) {
    test(name, () => {
      // #given
      const sandbox = makeSandbox();
      const dump = dumpFile(ORIGIN, "## Todos\n- [ ] #todo A.\n");
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
