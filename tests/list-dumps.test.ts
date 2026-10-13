import { describe, expect, test } from "bun:test";
import { DEV_ORIGIN as ORIGIN, DUMP_AT, dumpFile, makeSandbox, run, writeVaultFile, vaultFileHash } from "./harness.ts";


describe("brain-dump list-dumps", () => {
  test("lists a Dump's Items with their kind, text, Rationale and state", () => {
    // #given
    const sandbox = makeSandbox();
    const body = `## Learnings
- [x] Bun runs TypeScript directly.

## Decisions
- [ ] Filing is append-only.
\t- Why: protect curated notes.

## Todos
- [-] #todo Rewrite the README.
- [ ] #todo Ship the file skill.
`;
    writeVaultFile(sandbox, "Inbox/2026-10-05 1940 Brain-Dump - filing.md", dumpFile(ORIGIN, body));

    // #when
    const result = run(sandbox, ["list-dumps"]);

    // #then
    expect(JSON.parse(result.stdout)).toEqual([
      {
        file: "Inbox/2026-10-05 1940 Brain-Dump - filing.md",
        title: "2026-10-05 1940 Brain-Dump - filing",
        date: "2026-10-05",
        project: "Brain-Dump",
        label: "Brain-Dump",
        hash:vaultFileHash(sandbox, "Inbox/2026-10-05 1940 Brain-Dump - filing.md"),
        items: [
          { index: 1, kind: "Learning", text: "Bun runs TypeScript directly.", rationale: null, state: "filed" },
          { index: 2, kind: "Decision", text: "Filing is append-only.", rationale: "protect curated notes.", state: "open" },
          { index: 3, kind: "Todo", text: "#todo Rewrite the README.", rationale: null, state: "dropped" },
          { index: 4, kind: "Todo", text: "#todo Ship the file skill.", rationale: null, state: "open" },
        ],
      },
    ]);
  });

  test("lists only Dumps with open Items in the Inbox, oldest first", () => {
    // #given
    const sandbox = makeSandbox();
    const open = "## Todos\n- [ ] #todo Do it.\n";
    const done = "## Todos\n- [x] #todo Done.\n";
    writeVaultFile(sandbox, "Inbox/2026-10-06 0900 B - newer.md", dumpFile(ORIGIN, open));
    writeVaultFile(sandbox, "Inbox/2026-10-04 0900 A - older.md", dumpFile(ORIGIN, open));
    writeVaultFile(sandbox, "Inbox/2026-10-05 0900 C - finished.md", dumpFile(ORIGIN, done));
    writeVaultFile(sandbox, "Inbox/Filed/2026-10-01 0900 D - filed.md", dumpFile(ORIGIN, open));
    writeVaultFile(sandbox, "Inbox/Filing Routes.md", "Brain-Dump → [[Brain-Dump]]\n");

    // #when
    const result = run(sandbox, ["list-dumps"]);

    // #then
    expect(JSON.parse(result.stdout).map((dump: { file: string }) => dump.file)).toEqual([
      "Inbox/2026-10-04 0900 A - older.md",
      "Inbox/2026-10-06 0900 B - newer.md",
    ]);
  });

  test("gives a chat Dump the Project its origin line names, or none, and its tool as its label", () => {
    // #given
    const sandbox = makeSandbox();
    const body = "## Todos\n- [ ] #todo Do it.\n";
    run(sandbox, ["write-dump", "--tool", "ClaudeWeb", "--slug", "named", "--at", DUMP_AT, "--project", "Brain-Dump"], { stdin: body });
    run(sandbox, ["write-dump", "--tool", "Gemini", "--slug", "unnamed", "--at", DUMP_AT], { stdin: body });

    // #when
    const result = run(sandbox, ["list-dumps"]);

    // #then
    expect(JSON.parse(result.stdout).map(({ title, project, label }: Record<string, unknown>) => ({ title, project, label }))).toEqual([
      { title: "2026-10-05 1940 ClaudeWeb - named", project: "Brain-Dump", label: "ClaudeWeb" },
      { title: "2026-10-05 1940 Gemini - unnamed", project: null, label: "Gemini" },
    ]);
  });

  test("fails naming the Dump it can't read and why", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, "Inbox/2026-10-05 1940 Brain-Dump - bare.md", "## Todos\n- [ ] #todo Do it.\n");

    // #when
    const result = run(sandbox, ["list-dumps"]);

    // #then
    expect([result.exitCode, result.stderr]).toEqual([1, "brain-dump: Inbox/2026-10-05 1940 Brain-Dump - bare.md: no frontmatter\n"]);
  });

  test("prints an empty list when the Inbox has no Dumps", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = run(sandbox, ["list-dumps"]);

    // #then
    expect(JSON.parse(result.stdout)).toEqual([]);
  });
});
