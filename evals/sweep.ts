import { readFileSync } from "node:fs";
import { join } from "node:path";
import { capText, draft, DRAFTING_MODEL } from "../src/drafting.ts";
import type { DevOrigin } from "../src/origin.ts";
import { parseSessionText, renderSessionText } from "../src/transcript.ts";
import { checkDraft, type DraftExpectation } from "./assertions.ts";
import type { CaseResult, Eval } from "./eval.ts";
import { DUMP_RUBRIC, grade } from "./rubric.ts";

// The Sweep's drafting agent, run through the helper's own drafting module on synthetic extracted Session text.

const FIXTURES = "evals/fixtures/sweep";

type SweepCase = { fixture: string; expected: DraftExpectation | "no-items" };

const CASES: SweepCase[] = [
  {
    fixture: "cache-backend.txt",
    expected: {
      items: { Learnings: [1, 4], Decisions: [1, 3], Todos: [1, 3] },
      mentions: [/sqlite/i, /WAL/, /evict|expir|older than/i],
      never: [/semicolon/i],
    },
  },
  { fixture: "readme-typo.txt", expected: "no-items" },
  {
    fixture: "leaked-key.txt",
    expected: {
      items: { Learnings: [1, 3], Decisions: [0, 2], Todos: [1, 3] },
      mentions: [/sandbox|test mode/i, /rotat/i],
      never: [/sk-test-\w{6,}/],
    },
  },
  {
    // Over the cap: a decision sits only in the middle the cap leaves out, so the draft can't hold it.
    fixture: "over-cap.txt",
    expected: {
      items: { Learnings: [1, 4], Decisions: [1, 3], Todos: [1, 3] },
      mentions: [/zstd/i, /retention|30[- ]day/i],
      never: [/NATS/],
    },
  },
];

const ORIGIN: DevOrigin = { kind: "dev", tool: "ClaudeCode", project: "harbor", location: "/fixtures/harbor", branch: "main", at: new Date("2026-10-01T18:00:00Z"), notes: [] };
const SESSION = { id: "fixture", through: ORIGIN.at };

export const SWEEP_EVAL: Eval = {
  name: "sweep",
  model: DRAFTING_MODEL,
  // The drafting agent, its reply contract and the `write-dump` checks are inputs too: a change to any of them changes what the eval scores.
  inputs: ["src/prompts.ts", "skills/dump/item-rules.md", "src/drafting.ts", "src/transcript.ts", "src/dump.ts", "src/dump-body.ts", "src/secrets.ts", "evals/sweep.ts", "evals/assertions.ts", ...CASES.map(({ fixture }) => `${FIXTURES}/${fixture}`)],
  cases: CASES.map((sweepCase) => ({ name: sweepCase.fixture.replace(/\.txt$/, ""), run: () => runCase(sweepCase) })),
};

async function runCase({ fixture, expected }: SweepCase): Promise<CaseResult> {
  // Through the text form both ways, so the agent sees a fixture exactly as the Sweep would render its Session.
  const text = renderSessionText(parseSessionText(readFileSync(join(import.meta.dir, "..", FIXTURES, fixture), "utf8")));
  const outcome = draft(text, ORIGIN, SESSION);
  switch (outcome.kind) {
    case "no-items":
      return { failures: expected === "no-items" ? [] : ["drafted no Items"] };
    case "dump":
      if (expected === "no-items") return { failures: [`drafted a Dump, "${outcome.slug}", from a Session with nothing worth keeping`] };
      return { failures: checkDraft(outcome.slug, outcome.body, expected), grade: await grade(DUMP_RUBRIC, capText(text).text, outcome.body) };
    case "secret":
      return { failures: [`write-dump refused the body: line ${outcome.line} looks like it holds ${outcome.secretKind}`] };
    case "invalid":
    case "off-contract":
    case "agent-failed":
      return { failures: [outcome.error] };
  }
}
