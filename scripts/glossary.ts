import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";

// `bun run glossary`: fails when an avoided Glossary term appears where users or agents read it. GLOSSARY itself, ADRs and code identifiers
// are out of scope; in the helper's source only string literals are read.

const PROSE = ["skills/**/*.md", "prompts/**/*.md", "README.md", "docs/spec/**/*.md"];
const SOURCE = ["src/**/*.ts"];

/** Past specs are records, like ADRs: their wording stays as it was. */
const SUPERSEDED_SPECS = new Set(["docs/spec/v1.md", "docs/spec/v2.md"]);

/** Avoided terms whose other sense is right far more often than the avoided one, so a word match can't tell a slip from correct use. */
const UNCHECKED: Record<string, string[]> = {
  "part of another Glossary term or a format": ["note", "line", "chat", "rule", "bullet", "why", "summary", "index", "preview", "Weekly update", "main note"],
  "an everyday word in its own right": ["entry", "commit", "page", "thread", "fact", "heading", "task", "search", "lookup", "query", "alias", "mapping", "batch", "conversation", "rewrite", "proposal", "category", "cleanup"],
};
const UNCHECKED_TERMS = new Set(Object.values(UNCHECKED).flat().map((term) => term.toLowerCase()));

export type GlossaryHit = { file: string; line: number; term: string };

export function glossaryHits(root: string): GlossaryHit[] {
  const terms = avoidedTerms(readFileSync(join(root, "GLOSSARY.md"), "utf8"));
  const read = (patterns: string[], toSearchable: (text: string) => string) =>
    patterns
      .flatMap((pattern) => [...new Glob(pattern).scanSync(root)])
      .filter((file) => !SUPERSEDED_SPECS.has(file))
      .map((file) => ({ file, text: toSearchable(readFileSync(join(root, file), "utf8")) }));
  const files = [...read(PROSE, proseText), ...read(SOURCE, stringLiterals)].sort((a, b) => (a.file < b.file ? -1 : 1));
  return files.flatMap(({ file, text }) =>
    text.split("\n").flatMap((content, i) =>
      terms
        .flatMap((term) => [...content.matchAll(termPattern(term))].map((match) => ({ term, column: match.index })))
        .sort((a, b) => a.column - b.column)
        .map(({ term }) => ({ file, line: i + 1, term })),
    ),
  );
}

function avoidedTerms(glossary: string): string[] {
  const terms = [...glossary.matchAll(/^_Avoid_:(.*)$/gm)].flatMap((match) => (match[1] ?? "").split(",").map((term) => term.trim()));
  const checked = terms.filter((term) => term !== "" && !UNCHECKED_TERMS.has(term.toLowerCase()));
  return [...new Map(checked.map((term) => [term.toLowerCase(), term])).values()];
}

function termPattern(term: string): RegExp {
  const words = term.split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?<![\\w-])${words.join("\\s+")}(?:s|es)?(?![\\w-])`, "gi");
}

const blank = (text: string): string => text.replace(/[^\n]/g, " ");

function proseText(markdown: string): string {
  return markdown
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, blank)
    .replace(/(`+)[\s\S]*?\1/g, blank)
    .replace(/\[\[[^\]\n]*\]\]/g, blank)
    .replace(/\]\([^)\n]*\)/g, blank);
}

/** Keywords after which a `/` opens a regex literal rather than dividing. */
const BEFORE_REGEX = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await"]);

/** The source with everything but the contents of string and template literals blanked. */
function stringLiterals(source: string): string {
  const out = blank(source).split("");
  const keep = (from: number, to: number) => {
    for (let i = from; i < to; i++) out[i] = source[i] ?? " ";
  };
  // Each entry is the brace depth at which a template's `${` resumes code; `}` at that depth returns to the template.
  const templates: number[] = [];
  let depth = 0;
  let previous = "";
  let i = 0;

  const scanTemplate = () => {
    const start = i;
    while (i < source.length) {
      if (source[i] === "\\") i += 2;
      else if (source[i] === "`") {
        keep(start, i);
        i++;
        previous = "`";
        return;
      } else if (source.startsWith("${", i)) {
        keep(start, i);
        i += 2;
        templates.push(depth);
        depth++;
        previous = "{";
        return;
      } else i++;
    }
    keep(start, i);
  };

  while (i < source.length) {
    const char = source[i] ?? "";
    if (source.startsWith("//", i)) {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
    } else if (char === '"' || char === "'") {
      const start = ++i;
      while (i < source.length && source[i] !== char && source[i] !== "\n") i += source[i] === "\\" ? 2 : 1;
      keep(start, i);
      i++;
      previous = char;
    } else if (char === "`") {
      i++;
      scanTemplate();
    } else if (char === "/" && (previous === "" || /[(,=:[!&|?{};+\-*%<>~^]/.test(previous) || BEFORE_REGEX.has(previous))) {
      i++;
      let inClass = false;
      while (i < source.length && source[i] !== "\n" && (inClass || source[i] !== "/")) {
        if (source[i] === "\\") i++;
        else if (source[i] === "[") inClass = true;
        else if (source[i] === "]") inClass = false;
        i++;
      }
      i++;
      previous = "/regex";
    } else if (/\s/.test(char)) {
      i++;
    } else if (/[\w$]/.test(char)) {
      const start = i;
      while (i < source.length && /[\w$]/.test(source[i] ?? "")) i++;
      previous = source.slice(start, i);
    } else {
      i++;
      if (char === "{") depth++;
      else if (char === "}") {
        depth--;
        if (templates.at(-1) === depth) {
          templates.pop();
          scanTemplate();
          continue;
        }
      }
      previous = char;
    }
  }
  return out.join("");
}

if (import.meta.main) {
  const root = process.argv[2] ?? join(import.meta.dir, "..");
  const hits = glossaryHits(root);
  for (const { file, line, term } of hits) console.error(`${file}:${line}: "${term}" is an avoided Glossary term`);
  if (hits.length > 0) process.exitCode = 1;
}
