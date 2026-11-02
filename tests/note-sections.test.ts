import { describe, expect, test } from "bun:test";
import { renderFiledItem } from "../src/curated.ts";
import { BrainDumpError } from "../src/errors.ts";
import { filedText, nearest, ownText, readSections, resolveSection, sectionText, type Section } from "../src/note-sections.ts";

type Shape = { name: string; line: number; sections: Shape[] };

function shape(section: Section): Shape {
  return { name: section.name, line: section.line, sections: section.sections.map(shape) };
}

describe("Sections", () => {
  test("lines before the first heading are the note's own Section, and headings nest by level", () => {
    // #given
    const contents = "intro\n# Top\n## Child\ntext\n## Sibling\n# Second\n";

    // #when
    const { root } = readSections("Chronos", contents);

    // #then
    expect(shape(root)).toEqual({
      name: "[[Chronos]]",
      line: 0,
      sections: [
        {
          name: "[[Chronos#Top]]",
          line: 1,
          sections: [
            { name: "[[Chronos#Top#Child]]", line: 2, sections: [] },
            { name: "[[Chronos#Top#Sibling]]", line: 4, sections: [] },
          ],
        },
        { name: "[[Chronos#Second]]", line: 5, sections: [] },
      ],
    });
  });

  test("a note with no headings is one Section", () => {
    // #given
    const contents = "- a bullet\nsome text\n";

    // #when
    const { root } = readSections("Chronos", contents);

    // #then
    expect(shape(root)).toEqual({ name: "[[Chronos]]", line: 0, sections: [] });
  });

  test("a heading that skips a level nests under the nearest higher one", () => {
    // #given
    const contents = "# Top\n### Deep\n## Middle\n";

    // #when
    const { root } = readSections("Chronos", contents);

    // #then
    expect(shape(root).sections).toEqual([
      {
        name: "[[Chronos#Top]]",
        line: 0,
        sections: [
          { name: "[[Chronos#Top#Deep]]", line: 1, sections: [] },
          { name: "[[Chronos#Top#Middle]]", line: 2, sections: [] },
        ],
      },
    ]);
  });

  test("names a heading as Obsidian links it, dropping the characters a link can't hold", () => {
    // #given
    const contents = "## Q3: plans | goals ^ok [[draft]] #1 ##\n";

    // #when
    const { root } = readSections("Chronos", contents);

    // #then
    expect(root.sections.map((section) => [section.heading, section.name])).toEqual([["Q3: plans | goals ^ok [[draft]] #1", "[[Chronos#Q3 plans goals ok draft 1]]"]]);
  });

  test("reads a CRLF note as an LF one", () => {
    // #given
    const contents = "intro\n# Top\n## Child\ntext\n";

    // #when
    const [crlf, lf] = [contents.replaceAll("\n", "\r\n"), contents].map((text) => shape(readSections("Chronos", text).root));

    // #then
    expect(crlf).toEqual(lf);
  });

  test("a # line inside a code fence opens no Section", () => {
    // #given
    const contents = "# Top\n```sh\n# a shell comment\n```\n";

    // #when
    const { root } = readSections("Chronos", contents);

    // #then
    expect(shape(root).sections).toEqual([{ name: "[[Chronos#Top]]", line: 0, sections: [] }]);
  });
});

describe("resolving a Section's name", () => {
  const note = readSections("Chronos", "# Week 1\n## Notes\n### Q3: plans!\n# Week 2\n## Notes\n## Retro\n");
  const resolved = (name: string) => resolveSection(note, name).name;

  test("resolves the full heading path", () => {
    // #when
    const name = resolved("[[Chronos#Week 2#Notes]]");

    // #then
    expect(name).toBe("[[Chronos#Week 2#Notes]]");
  });

  test("resolves a unique deepest heading alone", () => {
    // #when
    const name = resolved("[[Chronos#Retro]]");

    // #then
    expect(name).toBe("[[Chronos#Week 2#Retro]]");
  });

  test("matches ignoring case, surrounding whitespace and the punctuation Obsidian ignores", () => {
    // #when
    const names = ["[[Chronos# q3 PLANS ]]", "[[Chronos#Q3: plans!]]", "[[Chronos#week 1#notes#Q3 plans]]"].map(resolved);

    // #then
    expect(names).toEqual(Array(3).fill("[[Chronos#Week 1#Notes#Q3 plans!]]"));
  });

  test("refuses a name matching several Sections, naming their lines and a full path", () => {
    // #when
    const resolving = () => resolved("[[Chronos#Notes]]");

    // #then
    expect(resolving).toThrow(new BrainDumpError("[[Chronos#Notes]] matches lines 2 and 5 of Chronos; pass its full path, e.g. [[Chronos#Week 1#Notes]]"));
  });

  test("refuses an unknown name with the nearest Section names", () => {
    // #when
    const resolving = () => resolved("[[Chronos#Week 3 retro]]");

    // #then
    expect(resolving).toThrow(
      new BrainDumpError(
        "[[Chronos#Week 3 retro]] is not a Section of Chronos; nearest: [[Chronos#Week 2#Retro]], [[Chronos#Week 1#Notes]], [[Chronos#Week 2#Notes]], [[Chronos#Week 1]], [[Chronos#Week 2]]",
      ),
    );
  });
});

describe("nearest names", () => {
  test("ranks by shared words, then edit distance, keeping up to five", () => {
    // #given
    const candidates = ["Kubernetes cluster networking", "Zebra", "Retries", "Queues", "Queue retry", "Queue retries policy"];

    // #when
    const ranked = nearest("queue retries", candidates);

    // #then
    expect(ranked).toEqual(["Queue retries policy", "Queue retry", "Retries", "Queues", "Zebra"]);
  });
});

describe("filed lines", () => {
  const DUMP = { title: "2026-10-05 1940 Brain-Dump - filing", date: "2026-10-05" };
  const early = renderFiledItem({ kind: "Learning", text: "Queues are FIFO.", rationale: null }, DUMP);
  const middle = renderFiledItem({ kind: "Decision", text: "Retry three times.", rationale: "flaky network." }, DUMP);
  const late = renderFiledItem({ kind: "Learning", text: "Workers are idempotent.", rationale: null }, DUMP);
  const digest = ["> [!summary] Digest 10-01-26", "> - Queues are FIFO.", "", "^digest-100126"];
  const note = readSections(
    "Chronos",
    [...early, "intro", "# Top", "- a bullet", "top text", ...middle, "- [ ] a Todo #todo", "## Child", "child text", ...digest, "# Second", "second text", ...late, ""].join("\n"),
  );
  const [top, second] = note.root.sections;

  test("a Section's text holds its nested Sections and none of the note's filed lines", () => {
    // #when
    const text = top && sectionText(note, top);

    // #then
    expect(text).toBe("# Top\n- a bullet\ntop text\n- [ ] a Todo #todo\n## Child\nchild text\n");
  });

  test("filed lines and Digests before, between and after headings are the note's filed lines, in order", () => {
    // #when
    const text = filedText(note);

    // #then
    expect(text).toBe(`${[...early, ...middle, ...digest, ...late].join("\n")}\n`);
  });

  test("a Section's own text stops at its first nested Section", () => {
    // #when
    const text = top && ownText(note, top);

    // #then
    expect(text).toBe("# Top\n- a bullet\ntop text\n- [ ] a Todo #todo\n");
  });

  test("a Section's size counts the bullets and lines under its heading and its nested Sections', less filed lines", () => {
    // #when
    const sizes = [note.root, top, second].map((section) => section && [section.bullets, section.lines]);

    // #then
    expect(sizes).toEqual([
      [2, 6],
      [2, 4],
      [0, 1],
    ]);
  });
});
