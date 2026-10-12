import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { contentHash } from "../src/content-hash.ts";
import type { Grade } from "./rubric.ts";
import { SWEEP_EVAL } from "./sweep.ts";

// Prompt evals score a prompt against committed synthetic fixtures on the pinned model, by hand with `bun run eval`; `bun test` checks each one passed
// against its current inputs.

const ROOT = join(import.meta.dir, "..");
const PASSED_PATH = join(import.meta.dir, "passed.json");

export const EVALS: Eval[] = [SWEEP_EVAL];

/** Everything that, once changed, needs a fresh pass: the pinned model, and the repo-relative prompt files, shared rules, fixtures and assertions. */
export type EvalInputs = { model: string; inputs: string[] };

export type Eval = EvalInputs & { name: string; cases: EvalCase[] };

/** One fixture: each run calls the real prompt once. */
export type EvalCase = { name: string; run: () => CaseResult };

/** `failures` gate; `grade` is advisory and absent when there was nothing to grade. */
export type CaseResult = { failures: string[]; grade?: Grade };

export type PassRecord = { hash: string; date: string; model: string };

export type PassRecords = Record<string, PassRecord>;

export function inputHash({ model, inputs }: EvalInputs): string {
  const hashed = inputs.map((path) => [path, contentHash(readFileSync(resolve(ROOT, path)))]);
  return contentHash(JSON.stringify({ model, inputs: hashed }));
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
