import { readFileSync, rmSync } from "node:fs";
import { claudeProjectFolder } from "../src/claude-sessions.ts";
import { ITEM_RULES_PATH } from "../src/prompts.ts";
import { makeEvalFolder, runClaude } from "./agent.ts";

// The advisory grade: the pinned model scores a draft 1–5 per criterion. It is printed beside the result and never gates.

export type Criterion = { name: string; ask: string };

export type Grade = { scores: Record<string, number> } | { error: string };

export const DUMP_RUBRIC: Criterion[] = [
  { name: "self-contained", ask: "Each Item reads cold a month from now, without the Session." },
  { name: "worth keeping", ask: "Every Item passes the month-from-now test: no play-by-play, no dead ends that taught nothing." },
  { name: "coverage", ask: "Nothing in the transcript worth keeping a month from now is missing." },
  { name: "rationale", ask: "Each Decision's Why line gives the real reason it was chosen over the alternatives." },
];

/** A tool-less run in a throwaway eval folder, so no project's settings reach the grader and nothing it leaves outlives the eval. */
export async function grade(criteria: Criterion[], transcript: string, body: string): Promise<Grade> {
  const cwd = makeEvalFolder();
  const graded = await runClaude({ prompt: gradingPrompt(criteria, transcript, body), cwd, tools: [] }).finally(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(claudeProjectFolder(cwd), { recursive: true, force: true });
  });
  if (!graded.ok) return { error: graded.error };
  const { reply } = graded;
  const scores: Record<string, number> = {};
  for (const line of reply.split("\n")) {
    const scored = /^\s*(?:\d+[.)]\s+)?(.+?)\s*:\s*([1-5])\s*$/.exec(line.replaceAll("*", ""));
    const label = scored?.[1]?.toLowerCase();
    const criterion = criteria.find(({ name }, index) => label === name || label === String(index + 1));
    if (scored?.[2] && criterion) scores[criterion.name] = Number(scored[2]);
  }
  const missing = criteria.filter(({ name }) => scores[name] === undefined);
  if (missing.length > 0) return { error: `grader gave no score for ${missing.map(({ name }) => name).join(", ")}: "${reply.trim().split("\n")[0]}"` };
  return { scores };
}

function gradingPrompt(criteria: Criterion[], transcript: string, body: string): string {
  return `Grade a Dump drafted from a Claude Code Session transcript under the rules below. Score each criterion from 1 (poor) to 5 (excellent).

## Criteria

${criteria.map(({ name, ask }, index) => `${index + 1}. ${name}: ${ask}`).join("\n")}

## Reply

One line per criterion, \`<criterion>: <score>\` (e.g. \`coverage: 4\`), and nothing else.

## The rules the Dump was drafted under

${readFileSync(ITEM_RULES_PATH, "utf8")}
## Transcript

${transcript}

## Dump

${body}`;
}
