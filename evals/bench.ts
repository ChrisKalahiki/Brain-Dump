import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { datePart, now, pad } from "../src/clock.ts";
import { curatedBullets } from "../src/curated.ts";
import { agentCommand, AGENT_VARIABLE, DRAFTING_MODEL } from "../src/drafting.ts";
import { descendants, headingPath, ownText, readSections } from "../src/note-sections.ts";
import { renderOutline, type OutlinedNote, type OutlineSection } from "../src/outline.ts";
import type { RecalledSection } from "../src/recall.ts";
import { stateFolder } from "../src/runs.ts";
import { parseGenerated, parseQuestions, renderQuestion, type BenchQuestion } from "./bench-questions.ts";
import { answerLinks, score, type Answered, type Resolved, type Score } from "./bench-score.ts";

// `bun run bench [--generate]` (spec 04): scores four ways of finding a Section on the real Vault with two models. It reads the Vault only by running
// `brain-dump` commands, calls models through ADR 0009's tool-less, unsaved spawn, and writes only in the bench folder. Never part of `check` or CI.

const STRONGER_MODEL = "claude-opus-5-5";
const MODELS = [DRAFTING_MODEL, STRONGER_MODEL];
/** Paraphrasing is judged by the stronger model, so questions don't echo the note's words. */
const GENERATOR_MODEL = STRONGER_MODEL;
const CONCURRENCY = 4;
const CALL_TIMEOUT_MS = 10 * 60 * 1000;
const MIN_BULLETS = 3;
const QUESTIONS_PER_SECTION = 2;
const HYBRID_LISTED = 10;
const CANDIDATES = ["A bm25", "B outline", "C drill-down", "D hybrid"] as const;
const OVERALL = "overall";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const BENCH_FOLDER = join(stateFolder(), "bench");
const QUESTION_SETS = [
  { set: "items", file: "items.txt" },
  { set: "sections", file: "sections.txt" },
  { set: "hand-written", file: "questions.txt" },
];

type Candidate = (typeof CANDIDATES)[number];
type Reply = { ok: true; stdout: string } | { ok: false; error: string };
type GoldQuestion = BenchQuestion & { set: string; resolved: Resolved };
type Outcome = { candidate: Candidate; model: string; set: string; question: string; gold: string; answers: string[]; answered: Answered; error?: string };
type Row = Score & { set: string; candidate: Candidate; model: string; failed: number };

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { generate: { type: "boolean" } }, strict: true });
  if (process.env[AGENT_VARIABLE]) return fail(`${AGENT_VARIABLE} is set; the bench runs the real models, so unset it`);
  mkdirSync(BENCH_FOLDER, { recursive: true });
  const notes = await brainDumpJson<OutlinedNote[]>(["outline", "--json"]);
  return values.generate ? generate(notes) : bench(notes);
}

async function generate(notes: OutlinedNote[]): Promise<number> {
  const generated = await Promise.all(notes.map(generateFor));
  for (const { set, file } of QUESTION_SETS.slice(0, 2)) {
    const lines = generated.flatMap((questions) => questions[set] ?? []);
    writeFileSync(join(BENCH_FOLDER, file), lines.length === 0 ? "" : `${lines.join("\n")}\n`);
    console.log(`${lines.length} questions in ${join(BENCH_FOLDER, file)}`);
  }
  return 0;
}

/** One generator call per note, for its backlinked Items and its Sections with at least three bullets of their own. */
async function generateFor(note: OutlinedNote): Promise<Record<string, string[]>> {
  const sections = flatten(note.sections).filter((section) => ownBullets(section) >= MIN_BULLETS);
  if (note.filed === 0 && sections.length === 0) return {};
  const shown = await brainDumpJson<{ text: string }>(["show", note.note, "--full"]);
  const sectioned = readSections(title(note.note), shown.text);
  const items = curatedBullets(sectioned.lines).filter(({ why, from }) => why !== undefined || from !== undefined);
  const known = [sectioned.root, ...descendants(sectioned.root)];
  const texts = sections.flatMap((section) => {
    const found = known.find(({ name }) => name === section.name);
    return found === undefined ? [] : [{ section: found, text: ownText(sectioned, found) }];
  });
  const prompt = generatorPrompt(
    note.note,
    items.map(({ text, why }) => (why === undefined ? text : `${text}\n   Why: ${why}`)),
    texts.map(({ text }) => text),
  );
  const reply = await ask(GENERATOR_MODEL, prompt);
  if (!reply.ok) {
    console.error(`${note.note}: no questions generated: ${reply.error}`);
    return {};
  }
  const questions = parseGenerated(reply.stdout);
  const link = noteLink(note.note);
  return {
    items: items.flatMap((_, index) => (questions.get(`I${index + 1}`) ?? []).slice(0, 1).map((question) => renderQuestion(question, `[[${link}]]`))),
    sections: texts.flatMap(({ section }, index) =>
      (questions.get(`S${index + 1}`) ?? []).slice(0, QUESTIONS_PER_SECTION).map((question) => renderQuestion(question, `[[${[link, ...section.path].join("#")}]]`)),
    ),
  };
}

function generatorPrompt(note: string, items: string[], sections: string[]): string {
  return [
    "You write questions for a retrieval benchmark over a personal notes Vault. Each question must be answerable from the text given for its key,",
    "asked the way someone would who remembers the idea but not the wording: paraphrase, and don't reuse the text's distinctive words.",
    `For each I key write one question; for each S key write ${QUESTIONS_PER_SECTION} different questions. Put each question on its own line, starting with its key, e.g. "S1: <question>".`,
    "Reply with those lines only.",
    "",
    `Note: ${note}`,
    ...items.map((item, index) => `\nI${index + 1}: ${item}`),
    ...sections.map((section, index) => `\nS${index + 1}:\n${section}`),
  ].join("\n");
}

async function bench(notes: OutlinedNote[]): Promise<number> {
  const questions = await readQuestions();
  if (questions.length === 0) return fail(`no questions in ${BENCH_FOLDER}; run bun run bench --generate or write questions.txt`);
  const outline = renderOutline(notes, Infinity);
  const noteLines = renderOutline(notes.map((note) => ({ ...note, sections: [] })), Infinity);
  const calls = questions.length * MODELS.length * 4;
  console.log(`${questions.length} questions; about ${calls} model calls; Outline ${outline.length} characters, note lines ${noteLines.length}`);
  const outcomes = (
    await Promise.all(
      questions.map(async (question) => {
      const bm25 = await recallSections(question.question);
      const top = bm25.slice(0, HYBRID_LISTED).map(({ note, section }) => sectionLink(note, section));
      const perModel = await Promise.all(
        MODELS.map(async (model) => [await outlineCandidate(question, model, outline), await drillDown(question, model, notes, noteLines), await hybrid(question, model, outline, top)]),
      );
      return [await answer(question, "A bm25", "-", { ok: true, links: top.slice(0, 3), chars: 0 }), ...perModel.flat()];
      }),
    )
  ).flat();
  const rows = tabulate(outcomes);
  printTable(rows);
  const at = now();
  const path = join(BENCH_FOLDER, `result-${datePart(at)}-${pad(at.getHours())}${pad(at.getMinutes())}.json`);
  writeFileSync(path, `${JSON.stringify({ date: at.toISOString(), models: MODELS, rows, outcomes }, null, 2)}\n`);
  console.log(`\nwritten to ${path}`);
  return 0;
}

/** Every question set present, each gold resolved through `show`; malformed lines and golds `show` refuses are reported and left out. */
async function readQuestions(): Promise<GoldQuestion[]> {
  const read = QUESTION_SETS.flatMap(({ set, file }) => {
    const path = join(BENCH_FOLDER, file);
    if (!existsSync(path)) return [];
    const { questions, malformed } = parseQuestions(readFileSync(path, "utf8"));
    for (const { line, error } of malformed) console.error(`${path}:${line}: ${error}`);
    return questions.map((question) => ({ ...question, set, path }));
  });
  const resolved = await Promise.all(read.map(async (question) => ({ question, gold: await resolve(question.gold) })));
  return resolved.flatMap(({ question: { path, ...question }, gold }) => {
    if (gold !== "refused") return [{ ...question, resolved: gold }];
    console.error(`${path}:${question.line}: show refuses ${question.gold}; left out`);
    return [];
  });
}

type Links = { ok: true; links: string[]; chars: number } | { ok: false; error: string; chars: number };

async function outlineCandidate(question: GoldQuestion, model: string, outline: string): Promise<Outcome> {
  return answer(question, "B outline", model, await pickSections(model, question.question, outline, ""));
}

async function hybrid(question: GoldQuestion, model: string, outline: string, top: string[]): Promise<Outcome> {
  const listed = `\nA keyword search over the Sections ranked these highest, best first:\n${top.map((link) => `- ${link}`).join("\n")}\n`;
  return answer(question, "D hybrid", model, await pickSections(model, question.question, outline, top.length === 0 ? "" : listed));
}

/** C's first call sees note lines only and picks notes; its second sees just those notes' Outlines. */
async function drillDown(question: GoldQuestion, model: string, notes: OutlinedNote[], noteLines: string): Promise<Outcome> {
  const picked = await ask(model, notesPrompt(question.question, noteLines));
  if (!picked.ok) return answer(question, "C drill-down", model, { ok: false, error: picked.error, chars: noteLines.length });
  const chosen = new Set(
    (await Promise.all(answerLinks(picked.stdout).map(resolve))).flatMap((resolved) => (resolved === "refused" ? [] : [resolved.note])),
  );
  const outline = renderOutline(notes.filter(({ note }) => chosen.has(note)), Infinity);
  const sections = chosen.size === 0 ? { ok: true as const, links: [], chars: 0 } : await pickSections(model, question.question, outline, "");
  return answer(question, "C drill-down", model, { ...sections, chars: noteLines.length + sections.chars });
}

/** `chars` counts the Outline and, for D, the list sent beside it. */
async function pickSections(model: string, question: string, outline: string, beside: string): Promise<Links> {
  const reply = await ask(model, sectionsPrompt(question, outline, beside));
  const chars = outline.length + beside.length;
  return reply.ok ? { ok: true, links: answerLinks(reply.stdout), chars } : { ok: false, error: reply.error, chars };
}

const OUTLINE_INTRO = "Below is the Outline of a personal notes Vault: a line per note (its path, tags, whether it has a digest, its filed Item count and hash), and under each note an indented line per Section with its heading and [bullets/lines].";

function sectionsPrompt(question: string, outline: string, beside: string): string {
  return [
    OUTLINE_INTRO,
    "",
    outline,
    beside,
    `Question: ${question}`,
    "",
    "Name up to 3 Sections most likely to answer the question, best first, one per line, each as [[<note path without .md>#<Section heading>]].",
    "A nested Section may be named by its own heading alone; the lines before a note's first heading are named [[<note path without .md>]]. Reply with the links only.",
  ].join("\n");
}

function notesPrompt(question: string, noteLines: string): string {
  return [
    "Below is a line per note in a personal notes Vault: its path, tags, whether it has a digest, its filed Item count and hash.",
    "",
    noteLines,
    `Question: ${question}`,
    "",
    "Name up to 3 notes most likely to answer the question, best first, one per line, each as [[<note path without .md>]]. Reply with the links only.",
  ].join("\n");
}

async function answer(question: GoldQuestion, candidate: Candidate, model: string, links: Links): Promise<Outcome> {
  const answers = links.ok ? links.links : [];
  const resolved = await Promise.all(answers.map(resolve));
  return {
    candidate,
    model,
    set: question.set,
    question: question.question,
    gold: question.gold,
    answers,
    answered: { gold: question.resolved, answers: resolved, outlineChars: links.chars },
    ...(links.ok ? {} : { error: links.error }),
  };
}

function tabulate(outcomes: Outcome[]): Row[] {
  const runs = [...new Map(outcomes.map(({ candidate, model }) => [`${candidate} ${model}`, { candidate, model }])).values()];
  const sets = [...QUESTION_SETS.map(({ set }) => set), OVERALL];
  return runs.flatMap(({ candidate, model }) =>
    sets.flatMap((set) => {
      const group = outcomes.filter((outcome) => outcome.candidate === candidate && outcome.model === model && (set === OVERALL || outcome.set === set));
      return group.length === 0 ? [] : [{ set, candidate, model, ...score(group.map(({ answered }) => answered)), failed: group.filter(({ error }) => error !== undefined).length }];
    }),
  );
}

function printTable(rows: Row[]): void {
  const percent = (n: number): string => `${(n * 100).toFixed(0)}%`;
  const table = [
    ["set", "candidate", "model", "questions", "R@1", "R@3", "invented", "Outline chars mean", "max", "failed calls"],
    ...rows.map((row) => [row.set, row.candidate, row.model, String(row.questions), percent(row.recallAt1), percent(row.recallAt3), percent(row.invented), String(row.outlineChars.mean), String(row.outlineChars.max), String(row.failed)]),
  ];
  const widths = table[0]?.map((_, column) => Math.max(...table.map((cells) => cells[column]?.length ?? 0))) ?? [];
  for (const cells of table) console.log(cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join("  ").trimEnd());
}

async function recallSections(question: string): Promise<RecalledSection[]> {
  const terms = question.split(/\s+/).filter((term) => term !== "" && !term.startsWith("--"));
  if (terms.length === 0) return [];
  const result = await brainDump(["recall", ...terms]);
  if (!result.ok) {
    console.error(`recall failed for "${question}": ${result.error}`);
    return [];
  }
  const parsed: { sections?: RecalledSection[] } = JSON.parse(result.stdout);
  return parsed.sections ?? [];
}

const resolved = new Map<string, Promise<Resolved | "refused">>();

/** What `show` makes of a name: the note and canonical Section it resolves to, or a refusal. */
function resolve(name: string): Promise<Resolved | "refused"> {
  const known = resolved.get(name);
  if (known !== undefined) return known;
  const showing = brainDump(["show", name]).then((result): Resolved | "refused" => {
    if (!result.ok) return "refused";
    const shown: { note: string; section?: string } = JSON.parse(result.stdout);
    return { note: shown.note, section: shown.section ?? null };
  });
  resolved.set(name, showing);
  return showing;
}

async function brainDumpJson<T>(args: string[]): Promise<T> {
  const result = await brainDump(args);
  if (!result.ok) throw new Error(`brain-dump ${args.join(" ")}: ${result.error}`);
  return JSON.parse(result.stdout);
}

function brainDump(args: string[]): Promise<Reply> {
  return spawn(["bun", CLI, ...args], "", "brain-dump");
}

function ask(model: string, prompt: string): Promise<Reply> {
  return spawn(agentCommand(model), prompt, model);
}

function spawn(command: string[], stdin: string, name: string): Promise<Reply> {
  return inTurn(async () => {
    try {
      const child = Bun.spawn(command, { cwd: homedir(), stdin: Buffer.from(stdin), stdout: "pipe", stderr: "pipe", timeout: CALL_TIMEOUT_MS });
      const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      if (exitCode === 0) return { ok: true, stdout };
      const said = (stderr.trim() || stdout.trim()).split("\n")[0];
      return { ok: false, error: `${name} failed (${child.signalCode === null ? `exit ${exitCode}` : "timed out"})${said ? `: ${said}` : ""}` };
    } catch (error) {
      return { ok: false, error: `cannot run ${name}: ${error instanceof Error ? error.message : String(error)}` };
    }
  });
}

let running = 0;
const waiting: (() => void)[] = [];

/** At most `CONCURRENCY` child processes at once, models and `brain-dump` alike. */
async function inTurn<T>(work: () => Promise<T>): Promise<T> {
  if (running >= CONCURRENCY) await new Promise<void>((start) => waiting.push(start));
  else running++;
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next === undefined) running--;
    else next();
  }
}

function flatten(sections: OutlineSection[]): OutlineSection[] {
  return sections.flatMap((section) => [section, ...flatten(section.sections)]);
}

/** A Section's bullets less its nested Sections', so a gold is never an enclosing Section that a nested one answers. */
function ownBullets(section: OutlineSection): number {
  return section.bullets - section.sections.reduce((sum, nested) => sum + nested.bullets, 0);
}

function noteLink(note: string): string {
  return note.replace(/\.md$/, "");
}

function title(note: string): string {
  return noteLink(note).split("/").at(-1) ?? note;
}

/** A recalled Section as a link by note path, so it can't name another note of the same title. */
function sectionLink(note: string, section: string): string {
  return `[[${[noteLink(note), ...headingPath(section)].join("#")}]]`;
}

function fail(message: string): number {
  console.error(`bench: ${message}`);
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
