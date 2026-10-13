import { parseArgs } from "node:util";
import { datePart, now } from "../src/clock.ts";
import { AGENT_VARIABLE } from "../src/sweep.ts";
import { EVALS, recordPass, type CaseResult, type Eval } from "./eval.ts";

// `bun run eval [name] [--runs N]`: runs each fixture N times on the real model; a pass with every run of every fixture passing is recorded.

/** A pass is only recorded with at least this many runs per fixture, so a lucky single run can't. */
const DEFAULT_RUNS = 3;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args: argv, options: { runs: { type: "string" } }, allowPositionals: true, strict: true });
  const runs = values.runs === undefined ? DEFAULT_RUNS : Number(values.runs);
  if (!Number.isInteger(runs) || runs < 1) return fail(`--runs "${values.runs}" is not a whole number of runs`);
  if (process.env[AGENT_VARIABLE]) return fail(`${AGENT_VARIABLE} is set; evals run the pinned model, so unset it`);
  const unknown = positionals.filter((name) => !EVALS.some((declared) => declared.name === name));
  if (unknown.length > 0) return fail(`no eval named ${unknown.join(", ")}; there are ${EVALS.map(({ name }) => name).join(", ")}`);
  const selected = positionals.length === 0 ? EVALS : EVALS.filter(({ name }) => positionals.includes(name));
  let passed = true;
  for (const declared of selected) passed = (await runEval(declared, runs)) && passed;
  return passed ? 0 : 1;
}

async function runEval(declared: Eval, runs: number): Promise<boolean> {
  console.log(`${declared.name} (${declared.model}, ${runs} run${runs === 1 ? "" : "s"} per fixture)`);
  let passed = true;
  for (const evalCase of declared.cases) {
    const results = await Promise.all(Array.from({ length: runs }, () => evalCase.run()));
    passed &&= results.every(({ failures }) => failures.length === 0);
    console.log(`  ${evalCase.name}  ${results.map(({ failures }) => (failures.length === 0 ? "pass" : "FAIL")).join(" ")}`);
    for (const [index, { failures }] of results.entries()) for (const failure of failures) console.log(`    run ${index + 1}: ${failure}`);
    const rubric = describeGrades(results);
    if (rubric !== undefined) console.log(`    rubric (advisory): ${rubric}`);
  }
  if (!passed) {
    console.log(`${declared.name} failed; nothing recorded`);
  } else if (runs < DEFAULT_RUNS) {
    console.log(`${declared.name} passed; not recorded with fewer than ${DEFAULT_RUNS} runs per fixture`);
  } else {
    const record = recordPass(declared, datePart(now()));
    console.log(`${declared.name} passed; recorded ${record.hash} on ${record.date}`);
  }
  return passed;
}

/** Each criterion's mean score over the graded runs, and any grading errors. */
function describeGrades(results: CaseResult[]): string | undefined {
  const grades = results.flatMap(({ grade }) => (grade === undefined ? [] : [grade]));
  if (grades.length === 0) return undefined;
  const totals = new Map<string, number[]>();
  for (const grade of grades) {
    if ("error" in grade) continue;
    for (const [criterion, score] of Object.entries(grade.scores)) totals.set(criterion, [...(totals.get(criterion) ?? []), score]);
  }
  const means = [...totals].map(([criterion, scores]) => `${criterion} ${(scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1)}`);
  const errors = grades.flatMap((grade) => ("error" in grade ? [`ungraded: ${grade.error}`] : []));
  return [...means, ...errors].join(" · ");
}

function fail(message: string): number {
  console.error(`eval: ${message}`);
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
