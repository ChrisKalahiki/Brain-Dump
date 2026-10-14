import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { glossaryHits } from "../scripts/glossary.ts";

const SCRIPT = join(import.meta.dir, "..", "scripts", "glossary.ts");

const GLOSSARY = `# Toy

**Dump**:
One raw captured item.
_Avoid_: Capture, knowledge base

**Sweep**:
The scheduled run.
_Avoid_: Auto-dump
`;

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "brain-dump-glossary-"));
  for (const [path, text] of Object.entries({ "GLOSSARY.md": GLOSSARY, ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

describe("the Glossary check", () => {
  test("reports each avoided term in skills, prompts, README and specs with its file and line", () => {
    // #given
    const root = tree({
      "skills/dump/SKILL.md": "# Dump\n\nCapture this Session.\n",
      "prompts/chat.md": "Turn it into a Dump.\nKeep it out of your knowledge base.\n",
      "README.md": "The auto-dumps run daily.\n",
      "docs/spec/deepening.md": "Two captures and one Auto-dump.\n",
    });

    // #when
    const hits = glossaryHits(root);

    // #then
    expect(hits).toEqual([
      { file: "README.md", line: 1, term: "Auto-dump" },
      { file: "docs/spec/deepening.md", line: 1, term: "Capture" },
      { file: "docs/spec/deepening.md", line: 1, term: "Auto-dump" },
      { file: "prompts/chat.md", line: 2, term: "knowledge base" },
      { file: "skills/dump/SKILL.md", line: 3, term: "Capture" },
    ]);
  });

  test("reads string literals in the helper's source, not its identifiers or comments", () => {
    // #given
    const root = tree({
      "src/sweep.ts": [
        "// Capture runs here.",
        "const capture = 1;",
        'const message = "capture failed";',
        "const pattern = /capture/;",
        "const template = `${capture} auto-dump ${`knowledge base`}`;",
        "/* knowledge base */ const quoted = 'it\\'s a Capture';",
        "",
      ].join("\n"),
    });

    // #when
    const hits = glossaryHits(root);

    // #then
    expect(hits).toEqual([
      { file: "src/sweep.ts", line: 3, term: "Capture" },
      { file: "src/sweep.ts", line: 5, term: "Auto-dump" },
      { file: "src/sweep.ts", line: 5, term: "knowledge base" },
      { file: "src/sweep.ts", line: 6, term: "Capture" },
    ]);
  });

  test("skips GLOSSARY, ADRs, superseded specs, code in Markdown, wikilinks, and terms with a common other sense", () => {
    // #given
    const root = tree({
      "GLOSSARY.md": `${GLOSSARY}\n**Learning**:\nSomething found out.\n_Avoid_: note\n`,
      "docs/adr/0001-capture.md": "Capture everything.\n",
      "docs/spec/v1.md": "Capture everything.\n",
      "skills/file/SKILL.md": "Append to the Topic Note.\n",
      "README.md": "Run `brain-dump capture`.\n\n```sh\ncapture --all\n```\n\nSee [[Auto-dump notes]].\n",
      "tests/sweep.test.ts": 'const message = "capture failed";\n',
    });

    // #when
    const hits = glossaryHits(root);

    // #then
    expect(hits).toEqual([]);
  });

  test("reads past a non-null assertion or postfix increment before a division", () => {
    // #given
    const root = tree({
      "src/count.ts": [
        'const ratio = total! / count; const message = "capture failed";',
        'const half = i++ / 2 + "a/b" + capture;',
        "",
      ].join("\n"),
    });

    // #when
    const hits = glossaryHits(root);

    // #then
    expect(hits).toEqual([{ file: "src/count.ts", line: 1, term: "Capture" }]);
  });

  test("a stray backtick or a longer fence hides nothing past its own extent", () => {
    // #given
    const root = tree({
      "README.md": "Press the ` key.\n\nCapture here.\n\n````md\n```\nfenced\n```\nCapture, still fenced.\n````\n\nAnd `x`, in the knowledge base.\n",
    });

    // #when
    const hits = glossaryHits(root);

    // #then
    expect(hits).toEqual([
      { file: "README.md", line: 3, term: "Capture" },
      { file: "README.md", line: 12, term: "knowledge base" },
    ]);
  });

  test("the command fails naming every hit", () => {
    // #given
    const root = tree({ "README.md": "Capture it.\n" });

    // #when
    const result = Bun.spawnSync(["bun", SCRIPT, root]);

    // #then
    expect({ exitCode: result.exitCode, stderr: result.stderr.toString() }).toEqual({
      exitCode: 1,
      stderr: 'README.md:1: "Capture" is an avoided Glossary term\n',
    });
  });

  test("the command passes on a clean tree", () => {
    // #given
    const root = tree({ "README.md": "Dump it.\n" });

    // #when
    const result = Bun.spawnSync(["bun", SCRIPT, root]);

    // #then
    expect(result.exitCode).toBe(0);
  });
});
