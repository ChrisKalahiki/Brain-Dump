import { describe, expect, test } from "bun:test";
import { makeSandbox, run, vaultFileHash, writeVaultFile, type Sandbox } from "./harness.ts";

const LEGEND = "# Outline · note: path · tags · digest · filed Items · hash · Section: name [bullets/lines]";
const CUT = '(cut: narrow with outline <folder> or outline "[[Note]]")';
const SQLITE ="Research/Main Notes/SQLite.md";
const CHRONOS = "Side Projects/Chronos.md";
const FILED = "- Partial indexes skip NULLs.\n\t- From [[2026-10-01 0900 chronos - indexes|dump 10-01-26]]\n";
const DIGEST = "> [!summary] Digest 10-10-26\n> - Indexes speed reads.\n\n^digest-101026\n";

/** Two Curated Notes, one with tags, a Digest and filed Items, plus notes the Outline never holds. */
function seedVault(sandbox: Sandbox): void {
  writeVaultFile(
    sandbox,
    SQLITE,
    `---\ntags:\n  - Databases\n  - SQL\n---\nAn intro line.\n## Indexes\n- B-trees\n${FILED}### Partial indexes\n- WHERE clause\nwhy it matters\n## Performance\n- WAL mode\n${DIGEST}`,
  );
  writeVaultFile(sandbox, CHRONOS, "# Chronos\n- queues\n");
  writeVaultFile(sandbox, "Research/Weekly Meetings/10-05-26 Weekly Update.md", "# To-Do:\n- [ ] a Todo #todo\n");
  writeVaultFile(sandbox, "Research/Briefings/Daily/2026-10-26 Daily Briefing.md", "# Daily Briefing\n- a Pick\n");
  writeVaultFile(sandbox, "Inbox/2026-10-01 0900 chronos - indexes.md", "## Learnings\n- a Learning\n");
}

function outline(sandbox: Sandbox, args: string[] = [], env: Record<string, string> = {}) {
  return run(sandbox, ["outline", ...args], { env });
}

describe("brain-dump outline", () => {
  test("prints the legend, then each Curated Note sorted by path with its Sections nested under it", () => {
    // #given
    const sandbox = makeSandbox();
    seedVault(sandbox);

    // #when
    const result = outline(sandbox);

    // #then
    expect(result.stdout).toBe(
      [
        LEGEND,
        `${SQLITE} · Databases, SQL · digest · 1 filed · ${vaultFileHash(sandbox, SQLITE)}`,
        "  (before first heading) [0/1]",
        "  ## Indexes [2/3]",
        "    ### Partial indexes [1/2]",
        "  ## Performance [1/1]",
        `${CHRONOS} · 0 filed · ${vaultFileHash(sandbox, CHRONOS)}`,
        "  # Chronos [1/1]",
        "",
      ].join("\n"),
    );
  });

  test("narrows to a folder in the knowledge trees, or to one note", () => {
    // #given
    const sandbox = makeSandbox();
    seedVault(sandbox);

    // #when
    const notes = [["Side Projects"], ["Side Projects/"], ["[[SQLite]]"], [SQLITE]].map((args) =>
      JSON.parse(outline(sandbox, [...args, "--json"]).stdout).map((note: { note: string }) => note.note),
    );

    // #then
    expect(notes).toEqual([[CHRONOS], [CHRONOS], [SQLITE], [SQLITE]]);
  });

  test.each([
    ["Research/Weekly Meetings", "use recall <terms…>"],
    ["Research/Weekly Meetings/2026", "use recall <terms…>"],
    ["[[10-05-26 Weekly Update]]", "use recall <terms…>"],
    ["Research", "outside the knowledge trees"],
    ["Inbox", "outside the knowledge trees"],
    ["Research/Briefings", "outside the knowledge trees"],
    ["../elsewhere", "not a folder in the Vault"],
    ["/etc", "not a folder in the Vault"],
    ["Resources/Missing", "not a folder in the Vault"],
    ["[[2026-10-26 Daily Briefing]]", "not a Curated Note"],
    ["[[2026-10-01 0900 chronos - indexes]]", "not a Curated Note"],
  ])("refuses %s", (scope, reason) => {
    // #given
    const sandbox = makeSandbox();
    seedVault(sandbox);

    // #when
    const result = outline(sandbox, [scope]);

    // #then
    expect([result.exitCode, result.stdout, result.stderr.includes(reason)]).toEqual([1, "", true]);
  });

  test("refuses more than one scope as a usage error", () => {
    // #given
    const sandbox = makeSandbox();
    seedVault(sandbox);

    // #when
    const result = outline(sandbox, ["Side Projects", "Resources"]);

    // #then
    expect(result.exitCode).toBe(2);
  });

  test("--json gives the whole tree, Sections nested with their names and sizes", () => {
    // #given
    const sandbox = makeSandbox();
    seedVault(sandbox);

    // #when
    const [sqlite] = JSON.parse(outline(sandbox, ["[[SQLite]]", "--json"]).stdout);

    // #then
    expect(sqlite).toEqual({
      note: SQLITE,
      tags: ["Databases", "SQL"],
      digest: true,
      filed: 1,
      hash: vaultFileHash(sandbox, SQLITE),
      sections: [
        { name: "[[SQLite]]", heading: null, level: 0, bullets: 0, lines: 1, sections: [] },
        {
          name: "[[SQLite#Indexes]]",
          heading: "Indexes",
          level: 2,
          bullets: 2,
          lines: 3,
          sections: [{ name: "[[SQLite#Indexes#Partial indexes]]", heading: "Partial indexes", level: 3, bullets: 1, lines: 2, sections: [] }],
        },
        { name: "[[SQLite#Performance]]", heading: "Performance", level: 2, bullets: 1, lines: 1, sections: [] },
      ],
    });
  });

  test("reports each note's hash as list-notes and show do, for CRLF notes too", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, CHRONOS, "# Chronos\r\n- queues\r\n");

    // #when
    const hashes = [
      JSON.parse(outline(sandbox, ["--json"]).stdout)[0].hash,
      JSON.parse(run(sandbox, ["list-notes"]).stdout)[0].hash,
      JSON.parse(run(sandbox, ["show", CHRONOS]).stdout).hash,
    ];

    // #then
    const onDisk = vaultFileHash(sandbox, CHRONOS);
    expect(hashes).toEqual([onDisk, onDisk, onDisk]);
  });

  describe("over the cap", () => {
    const DEEP = "Resources/Deep.md";
    const sqliteLine = (sandbox: Sandbox) => `${SQLITE} · Databases, SQL · digest · 1 filed · ${vaultFileHash(sandbox, SQLITE)}`;
    const chronosLine = (sandbox: Sandbox) => `${CHRONOS} · 0 filed · ${vaultFileHash(sandbox, CHRONOS)}`;

    test("drops Sections below the second heading level first, and says how to narrow it", () => {
      // #given
      const sandbox = makeSandbox();
      seedVault(sandbox);
      writeVaultFile(sandbox, DEEP, "## Top\n### One\n### Two\n### Three\n### Four\n");
      const shallow = [
        LEGEND,
        sqliteLine(sandbox),
        "  (before first heading) [0/1]",
        "  ## Indexes [2/3]",
        "  ## Performance [1/1]",
        `${DEEP} · 0 filed · ${vaultFileHash(sandbox, DEEP)}`,
        "  ## Top [0/0]",
        chronosLine(sandbox),
        "  # Chronos [1/1]",
        CUT,
        "",
      ].join("\n");

      // #when
      const result = outline(sandbox, [], { BRAIN_DUMP_OUTLINE_CAP: String(shallow.length) });

      // #then
      expect(result.stdout).toBe(shallow);
    });

    test("still over, lists notes only", () => {
      // #given
      const sandbox = makeSandbox();
      seedVault(sandbox);

      // #when
      const result = outline(sandbox, [], { BRAIN_DUMP_OUTLINE_CAP: "300" });

      // #then
      expect(result.stdout).toBe([LEGEND, sqliteLine(sandbox), chronosLine(sandbox), CUT, ""].join("\n"));
    });

    test("--json is never cut", () => {
      // #given
      const sandbox = makeSandbox();
      seedVault(sandbox);

      // #when
      const notes = JSON.parse(outline(sandbox, ["--json"], { BRAIN_DUMP_OUTLINE_CAP: "1" }).stdout);

      // #then
      expect(notes[0].sections[1].sections).toHaveLength(1);
    });
  });
});
