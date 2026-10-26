import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { contentHash } from "../src/content-hash.ts";
import { CHAT_DUMP_EVAL } from "./chat-dump.ts";
import { DUMP_EVAL } from "./dump.ts";
import { FILE_EVAL } from "./file.ts";
import type { Grade } from "./rubric.ts";
import { SWEEP_EVAL } from "./sweep.ts";
import { TODO_EVAL } from "./todo.ts";

// Prompt evals score a prompt against committed synthetic fixtures on the pinned model, by hand with `bun run eval`; `bun run eval:check`
// checks each one passed against its current inputs.

const ROOT = join(import.meta.dir, "..");
const PASSED_PATH = join(import.meta.dir, "passed.json");

export const EVALS: Eval[] = [SWEEP_EVAL, DUMP_EVAL, CHAT_DUMP_EVAL, FILE_EVAL, TODO_EVAL];

/**
 * Everything that, once changed, needs a fresh pass: the pinned model, every module reached through the `entries`' imports, and, as `inputs`,
 * what no import reaches: skill prose, prompts read at runtime and fixtures. Paths are repo-relative.
 */
export type EvalInputs = { model: string; entries: string[]; inputs: string[] };

export type Eval = EvalInputs & { name: string; cases: EvalCase[] };

/** One fixture: each run calls the real prompt once. A case's runs go in parallel when `run` is async. */
export type EvalCase = { name: string; run: () => CaseResult | Promise<CaseResult> };

/** `failures` gate; `grade` is advisory and absent when there was nothing to grade. */
export type CaseResult = { failures: string[]; grade?: Grade };

export type PassRecord = { hash: string; date: string; model: string };

export type PassRecords = Record<string, PassRecord>;

export function inputHash({ model, entries, inputs }: EvalInputs): string {
  const hashed = [...reachedModules(entries), ...inputs].map((path) => [path, contentHash(readFileSync(resolve(ROOT, path)))]);
  return contentHash(JSON.stringify({ model, inputs: hashed }));
}

const transpiler = new Bun.Transpiler({ loader: "ts" });

/**
 * The entries and every module they reach through relative imports, sorted. `scan` drops type-only imports, since they can't change behaviour;
 * unlike `scanImports`, it accepts the CLI's shebang. Relative specifiers name their file, extension included, as everywhere in the repo.
 */
function reachedModules(entries: string[]): string[] {
  const reached = new Set<string>();
  const visit = (path: string): void => {
    if (reached.has(path)) return;
    reached.add(path);
    for (const { path: specifier } of transpiler.scan(readFileSync(path, "utf8")).imports) {
      if (specifier.startsWith(".")) visit(resolve(dirname(path), specifier));
    }
  };
  for (const entry of entries) visit(resolve(ROOT, entry));
  return [...reached].map((path) => relative(ROOT, path)).sort();
}

/** One line per eval whose inputs differ from its last recorded pass. */
export function staleEvals(evals: Omit<Eval, "cases">[], passed: PassRecords = readPassed()): string[] {
  return evals.flatMap((declared) => {
    const record = passed[declared.name];
    const rerun = `run \`bun run eval ${declared.name}\``;
    if (record === undefined) return [`${declared.name}: no pass recorded; ${rerun}`];
    if (record.hash !== inputHash(declared)) return [`${declared.name}: inputs changed since the pass recorded on ${record.date}; ${rerun}`];
    return [];
  });
}

export function recordPass(declared: Eval, date: string): PassRecord {
  const record = { hash: inputHash(declared), date, model: declared.model };
  writeFileSync(PASSED_PATH, `${JSON.stringify({ ...readPassed(), [declared.name]: record }, null, 2)}\n`);
  return record;
}

function readPassed(): PassRecords {
  return existsSync(PASSED_PATH) ? (JSON.parse(readFileSync(PASSED_PATH, "utf8")) as PassRecords) : {};
}
