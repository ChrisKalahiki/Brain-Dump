import { describe, expect, test } from "bun:test";
import { appendOnlyViolation, checkboxOnlyViolation, todoMarkViolation, type ClosedMark, type Violation } from "../src/append-only.ts";

const RUNS = 500;
const PLACEHOLDERS = ["- ", "- [ ]", "- [ ] "];
const KEPT = ["Alpha", "beta", "- kept", "- [ ] task", "- [x] done", "", "# To-Do:", "---", "\t- detail", "-", "- [ ]x", " - "];
const NEW = ["- added", "new line", "", "- [ ] new task", "# Digest"];

/** Seeded so a failure names a case that can be replayed. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Case = { next: () => number; pick: <T>(items: readonly T[]) => T; index: (length: number) => number };

function forAll(property: (gen: Case, seed: number) => void): void {
  for (let seed = 1; seed <= RUNS; seed++) {
    const next = random(seed);
    const index = (length: number): number => Math.floor(next() * length);
    property({ next, index, pick: (items) => items[index(items.length)] as (typeof items)[number] }, seed);
  }
}

function noteLines(gen: Case, pool: readonly string[]): string[] {
  return Array.from({ length: 1 + gen.index(8) }, () => gen.pick(pool));
}

function join(lines: string[], eol: string, trailing: boolean): string {
  return lines.join(eol) + (trailing ? eol : "");
}

function appendTo(gen: Case, lines: string[]): string[] {
  const result = [...lines];
  for (let added = gen.index(4); added > 0; added--) result.splice(gen.index(result.length + 1), 0, gen.pick(NEW));
  return result;
}

describe("the append-only check", () => {
  test("passes every edit that only adds lines", () => {
    forAll((gen, seed) => {
      // #given
      const lines = noteLines(gen, [...KEPT, ...PLACEHOLDERS]);
      const eol = gen.pick(["\n", "\r\n"]);
      const trailing = gen.next() < 0.5;

      // #when
      const violation = appendOnlyViolation(join(lines, eol, trailing), join(appendTo(gen, lines), eol, trailing));

      // #then
      expect({ seed, violation }).toEqual({ seed, violation: undefined });
    });
  });

  test("passes an edit that replaces empty placeholder bullets", () => {
    forAll((gen, seed) => {
      // #given
      const lines = noteLines(gen, [...KEPT, ...PLACEHOLDERS, ...PLACEHOLDERS]);
      const edited = appendTo(gen, lines).flatMap((line) => (PLACEHOLDERS.includes(line) && gen.next() < 0.7 ? gen.pick([[], ["- filled"]]) : [line]));

      // #when
      const violation = appendOnlyViolation(join(lines, "\n", true), join(edited, "\n", true));

      // #then
      expect({ seed, violation }).toEqual({ seed, violation: undefined });
    });
  });

  test("fails an edit that deletes or changes a line that is not a placeholder", () => {
    forAll((gen, seed) => {
      // #given
      const lines = [...noteLines(gen, KEPT), "end"];
      const target = gen.index(lines.length);
      const original = lines[target] ?? "";
      const edited = [...lines];
      if (gen.next() < 0.5) edited.splice(target, 1);
      else edited[target] = `${original} changed`;

      // #when
      const violation = appendOnlyViolation(join(lines, "\n", true), join(edited, "\n", true));

      // #then
      const originalLines = join(lines, "\n", true).split("\n");
      const named = violation !== undefined && "line" in violation && originalLines[violation.line - 1] === violation.text;
      expect({ seed, named }).toEqual({ seed, named: true });
    });
  });

  test("names the first original line the edit lost", () => {
    // #given
    const original = "# Notes:\n- one\n- two\n- three\n";

    // #when
    const violation = appendOnlyViolation(original, "# Notes:\n- one\n- 2\n- three\n- four\n");

    // #then
    expect(violation).toEqual({ line: 3, text: "- two" });
  });

  test("fails an edit that swaps two different lines", () => {
    forAll((gen, seed) => {
      // #given
      const lines = noteLines(gen, KEPT);
      lines.push(...noteLines(gen, KEPT));
      const at = gen.index(lines.length - 1);
      if (lines[at] === lines[at + 1]) lines[at + 1] = `${lines[at]} other`;
      const swapped = [...lines];
      swapped.splice(at, 2, lines[at + 1] ?? "", lines[at] ?? "");

      // #when
      const violation = appendOnlyViolation(join(lines, "\n", false), join(swapped, "\n", false));

      // #then
      expect({ seed, failed: violation !== undefined }).toEqual({ seed, failed: true });
    });
  });

  test("fails an edit that changes the line endings", () => {
    forAll((gen, seed) => {
      // #given
      const lines = [...noteLines(gen, KEPT), "last"];
      const [from, to] = gen.pick([["\n", "\r\n"], ["\r\n", "\n"]] as const);

      // #when
      const violation = appendOnlyViolation(join(lines, from, gen.next() < 0.5), join(appendTo(gen, lines), to, true));

      // #then
      expect({ seed, violation }).toEqual({ seed, violation: { lineEndings: "changed" } });
    });
  });

  test("fails an edit that switches one line of a mixed-ending note to the other ending", () => {
    // #given
    const original = "# Notes:\r\n- kept\n- also\r\n";

    // #when
    const violation = appendOnlyViolation(original, "# Notes:\r\n- kept\r\n- also\n- added\r\n");

    // #then
    expect(violation).toEqual({ line: 2, text: "- kept" });
  });

  test("fails an edit that adds a line with the other line ending", () => {
    // #given
    const original = "# Notes:\r\n- kept\r\n";

    // #when
    const violation = appendOnlyViolation(original, "# Notes:\r\n- kept\r\n- added\n");

    // #then
    expect(violation).toEqual({ lineEndings: "changed" });
  });
});

describe("the checkbox-only check for a Dump", () => {
  const DUMP = "---\ntags:\n  - dump\n---\nSession: x\n\n## Todos\n- [ ] #todo A.\n- [ ] #todo B.\n- [x] #todo C.\n";

  test("passes ticking or dropping the planned Items with their planned marks", () => {
    // #given
    const next = DUMP.replace("- [ ] #todo A.", "- [x] #todo A.").replace("- [ ] #todo B.", "- [-] #todo B.");

    // #when
    const violation = checkboxOnlyViolation(DUMP, next, new Map([[7, "x"], [8, "-"]]));

    // #then
    expect(violation).toBeUndefined();
  });

  test("fails any other change, naming the first changed line", () => {
    // #given
    const planned = new Map<number, ClosedMark>([[7, "x"], [9, "x"]]);
    const cases: [string, string, Violation][] = [
      ["ticks an Item outside the plan", DUMP.replace("- [ ] #todo B.", "- [x] #todo B."), { line: 9, text: "- [ ] #todo B." }],
      ["changes a planned Item's text", DUMP.replace("- [ ] #todo A.", "- [x] #todo A!"), { line: 8, text: "- [ ] #todo A." }],
      ["drops an Item planned as filed", DUMP.replace("- [ ] #todo A.", "- [-] #todo A."), { line: 8, text: "- [ ] #todo A." }],
      ["reopens a filed Item", DUMP.replace("- [x] #todo C.", "- [ ] #todo C."), { line: 10, text: "- [x] #todo C." }],
      ["adds a line", DUMP.replace("## Todos\n", "## Todos\n- [ ] #todo D.\n"), { line: 8, text: "- [ ] #todo A." }],
      ["changes the line endings", DUMP.replaceAll("\n", "\r\n"), { line: 1, text: "---" }],
    ];

    // #when
    const violations = cases.map(([name, next]) => [name, checkboxOnlyViolation(DUMP, next, planned)]);

    // #then
    expect(violations).toEqual(cases.map(([name, , violation]) => [name, violation]));
  });
});

describe("the todo-mark check for a Weekly Note", () => {
  const NOTE = "# To-Do:\n- SaTC\n\t- [ ] Open #todo\n\t- [x] Done\n\t- [-] Dropped\n\t- [/] Started\n";

  test("passes a named Todo's mark changing between open, done and dropped in any direction", () => {
    // #given
    const pairs = [" ", "x", "-", "/"].flatMap((from) => [" ", "x", "-"].map((to) => [from, to]));

    // #when
    const violations = pairs.map(([from, to]) => [from, to, todoMarkViolation(`# To-Do:\r\n\t- [${from}] A\r\n`, `# To-Do:\r\n\t- [${to}] A\r\n`, new Set([1]))]);

    // #then
    expect(violations).toEqual(pairs.map(([from, to]) => [from, to, undefined]));
  });

  test("fails any other change, naming the first changed line", () => {
    // #given
    const named = new Set([2, 3]);
    const cases: [string, string, Violation][] = [
      ["marks a Todo not named", NOTE.replace("[-] Dropped", "[x] Dropped"), { line: 5, text: "\t- [-] Dropped" }],
      ["changes a named Todo's text", NOTE.replace("[ ] Open #todo", "[x] Opened #todo"), { line: 3, text: "\t- [ ] Open #todo" }],
      ["changes a named Todo's indent", NOTE.replace("\t- [ ] Open", "- [x] Open"), { line: 3, text: "\t- [ ] Open #todo" }],
      ["writes a mark other than ' ', x or -", NOTE.replace("[ ] Open", "[X] Open"), { line: 3, text: "\t- [ ] Open #todo" }],
      ["turns a named Todo into a plain bullet", NOTE.replace("- [ ] Open", "- Open"), { line: 3, text: "\t- [ ] Open #todo" }],
      ["adds a line", NOTE.replace("- SaTC\n", "- SaTC\n\t- [ ] New\n"), { line: 3, text: "\t- [ ] Open #todo" }],
      ["removes the last line", NOTE.replace("\t- [/] Started\n", ""), { line: 6, text: "\t- [/] Started" }],
      ["changes the line endings", NOTE.replaceAll("\n", "\r\n"), { line: 1, text: "# To-Do:" }],
    ];

    // #when
    const violations = cases.map(([name, next]) => [name, todoMarkViolation(NOTE, next, named)]);

    // #then
    expect(violations).toEqual(cases.map(([name, , violation]) => [name, violation]));
  });
});
