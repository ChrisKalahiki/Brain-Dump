import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inputHash, staleEvals } from "../evals/eval.ts";
import { checkPlan } from "../evals/plan.ts";

describe("prompt evals", () => {
  test("an eval's input hash changes when any input or the model changes, and only then", () => {
    // #given
    const folder = mkdtempSync(join(tmpdir(), "brain-dump-eval-"));
    const [prompt, fixture] = [join(folder, "prompt.md"), join(folder, "fixture.txt")];
    writeFileSync(prompt, "Draft a Dump.\n");
    writeFileSync(fixture, "User: hi\n");
    const declared = { inputs: [prompt, fixture], model: "model-a" };
    const before = inputHash(declared);

    // #when
    const unchanged = inputHash(declared);
    writeFileSync(fixture, "User: hello\n");
    const fixtureChanged = inputHash(declared);
    const modelChanged = inputHash({ ...declared, model: "model-b" });

    // #then
    expect({ unchanged: unchanged === before, fixtureChanged: fixtureChanged !== before, modelChanged: modelChanged !== fixtureChanged }).toEqual({
      unchanged: true,
      fixtureChanged: true,
      modelChanged: true,
    });
  });

  test("an eval whose inputs changed since its recorded pass is stale, naming the command to run", () => {
    // #given
    const folder = mkdtempSync(join(tmpdir(), "brain-dump-eval-"));
    const prompt = join(folder, "prompt.md");
    writeFileSync(prompt, "Draft a Dump.\n");
    const declared = { name: "toy", inputs: [prompt], model: "model-a" };
    const passed = { toy: { hash: inputHash(declared), date: "2026-10-12", model: "model-a" } };

    // #when
    const fresh = staleEvals([declared], passed);
    writeFileSync(prompt, "Draft a better Dump.\n");
    const changed = staleEvals([declared], passed);
    const neverPassed = staleEvals([declared], {});

    // #then
    expect({ fresh, changed, neverPassed }).toEqual({
      fresh: [],
      changed: ["toy: inputs changed since the pass recorded on 2026-10-12; run `bun run eval toy`"],
      neverPassed: ["toy: no pass recorded; run `bun run eval toy`"],
    });
  });
});

describe("the file eval's Filing Plan check", () => {
  const PLAN = `Vault check: clean

**2026-10-12 1800 harbor - cache work**

| # | Item | → Destination | As |
|---|---|---|---|
| ≈ 1 | Learning: WAL mode lets readers… | \`SQLite\` · end | bullet + backlink |
| 2 | Learning: Typst recompiles… | **NEW** \`Typst\` · end | bullet + backlink |
| 3 | Todo: Add a --json flag | \`10-12-26 Weekly Update\` · \`# To-Do:\` › **NEW** \`Tidewatch\` | \`- [ ] Add a --json flag. #todo\` |
| + | Link line | \`09-28-26 Weekly Update\` (**NEW**) · \`# Notes:\` | \`- Filed [[2026-09-30 1200 harbor - x|harbor x]]\` |

≈ 1 ~ [[SQLite]]: "WAL mode lets SQLite readers keep reading while one process writes."

New notes: \`Research/Main Notes/Typst.md\`

\`\`\`
Routine (2)
4 · Decision: Harbor fetches… → \`Harbor\` (via Route "harbor")
5 · Todo: Evict rows… → \`10-12-26 Weekly Update\` · \`Harbor\` (via Route "harbor")
\`\`\`

Reply: ok · skip N · drop N · cancel`;

  const EXPECTED = {
    "1": { note: "SQLite", marks: ["similar" as const] },
    "2": { note: "Typst", marks: ["new" as const] },
    "3": { note: "10-12-26 Weekly Update", marks: ["new-group" as const] },
    "4": { note: "Harbor", marks: ["routine" as const] },
    "5": { note: "10-12-26 Weekly Update", group: "Harbor", marks: ["routine" as const] },
    "+": { note: "09-28-26 Weekly Update", marks: ["new" as const] },
  };

  test("passes a plan whose every Item goes where expected with exactly the expected marks, from the table or the Routine list", () => {
    // #given
    const plan = PLAN;

    // #when
    const failures = checkPlan(plan, EXPECTED);

    // #then
    expect(failures).toEqual([]);
  });

  test("names each Item whose destination or marks differ, and each Item missing from the plan or not expected in it", () => {
    // #given
    const plan = PLAN.replace("| ≈ 1 |", "| 1 |").replace("**NEW** \`Typst\`", "\`Typst\`").replace("4 · Decision: Harbor fetches… → \`Harbor\`", "6 · Decision: Harbor fetches… → \`SQLite\`");
    const expected = { ...EXPECTED, "5": { ...EXPECTED["5"], group: "Dissertation" } };

    // #when
    const failures = checkPlan(plan, expected);

    // #then
    expect(failures).toEqual([
      'Item 1 → "SQLite · end" marked [none], expected [similar]',
      'Item 2 → "Typst · end" marked [none], expected [new]',
      "Item 4 is not in the plan",
      'Item 5 → "10-12-26 Weekly Update · Harbor", expected 10-12-26 Weekly Update › Dissertation',
      "Item 6 is in the plan, but no such Item was expected",
      "Item 1 has a ≈ line but is not marked ≈",
    ]);
  });

  test("fails an Item marked ≈ without its line below the table, and a ≈ line for an unmarked Item", () => {
    // #given
    const plan = PLAN.replace("≈ 1 ~ [[SQLite]]", "≈ 2 ~ [[SQLite]]");

    // #when
    const failures = checkPlan(plan, EXPECTED);

    // #then
    expect(failures).toEqual(["Item 1 is marked ≈ but has no ≈ line below the table", "Item 2 has a ≈ line but is not marked ≈"]);
  });

  test("reads a Routine line wrapped in backticks", () => {
    // #given
    const plan = PLAN.replace('5 · Todo: Evict rows… → `10-12-26 Weekly Update` · `Harbor` (via Route "harbor")', '`5 · Todo: Evict rows… → 10-12-26 Weekly Update · Harbor` (via Route "harbor")');

    // #when
    const failures = checkPlan(plan, EXPECTED);

    // #then
    expect({ changed: plan !== PLAN, failures }).toEqual({ changed: true, failures: [] });
  });

  const LINK_LINE = "| + | Link line | `09-28-26 Weekly Update` (**NEW**) · `# Notes:` | `- Filed [[2026-09-30 1200 harbor - x|harbor x]]` |";

  test.each([
    ["in the table", PLAN.replace(LINK_LINE, "| + | Link line | `10-12-26 Weekly Update` · `# Notes:` | `- Filed [[x|harbor x]]` |")],
    ["escaped, in the Routine list", PLAN.replace(LINK_LINE, "").replace("Routine (2)", "Routine (3)\n\\+ · Link line → `10-12-26 Weekly Update` · `# Notes:`")],
  ])("passes the link line to an existing Weekly Note %s", (_, plan) => {
    // #given
    const expected = { ...EXPECTED, "+": { note: "10-12-26 Weekly Update", marks: [] } };

    // #when
    const failures = checkPlan(plan, expected);

    // #then
    expect({ moved: plan.includes(LINK_LINE) ? "not moved" : "moved", failures }).toEqual({ moved: "moved", failures: [] });
  });

  test.each([
    ["a NEW note's", LINK_LINE, LINK_LINE.replace("(**NEW**)", "(**NEW**, copy of the Weekly Note template)")],
    ["a Routine line's", '(via Route "harbor")\n```', '(via Route "harbor"). Appends `- [ ] Evict rows. #todo`\n```'],
  ])("reads a destination past %s note in parentheses and anything after it", (_, from, to) => {
    // #given
    const plan = PLAN.replace(from, to);

    // #when
    const failures = checkPlan(plan, EXPECTED);

    // #then
    expect({ annotated: plan !== PLAN, failures }).toEqual({ annotated: true, failures: [] });
  });

  test("fails an Item listed twice", () => {
    // #given
    const plan = PLAN.replace("Routine (2)", "Routine (3)\n2 · Learning: Typst… → \`Typst\` (via Route \"Typst\")");

    // #when
    const failures = checkPlan(plan, EXPECTED);

    // #then
    expect(failures).toEqual(["Item 2 is in the plan 2 times"]);
  });
});
