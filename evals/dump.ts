import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDump } from "../src/dump.ts";
import { INBOX } from "../src/layout.ts";
import { DRAFTING_MODEL } from "../src/sweep.ts";
import { makeSkillSandbox, removeSkillSandbox, runClaude, writeSessionLog } from "./agent.ts";
import { checkDraft, type DraftExpectation } from "./assertions.ts";
import type { CaseResult, Eval } from "./eval.ts";
import { DUMP_RUBRIC, grade } from "./rubric.ts";

// `dump` in Claude Code: `/dump` sent at the end of a synthetic Session, the skill writing its Dump through the helper into a sandbox Vault.

const FIXTURES = "evals/fixtures/dump";

type DumpCase = { name: string; fixture: string; focus?: string; expected: DraftExpectation };

const CASES: DumpCase[] = [
  {
    name: "deploy-credentials",
    fixture: "deploy-credentials.txt",
    expected: {
      items: { Learnings: [1, 4], Decisions: [2, 3], Todos: [1, 2] },
      mentions: [/OIDC/, /id-token: write/, /SHA/, /trust policy/i],
      never: [/indentation/i],
    },
  },
  {
    name: "deploy-credentials-focus",
    fixture: "deploy-credentials.txt",
    focus: "just the decisions",
    expected: {
      items: { Learnings: [0, 0], Decisions: [2, 3], Todos: [0, 0] },
      mentions: [/OIDC/, /SHA/],
      never: [/indentation/i, /#todo/],
    },
  },
  {
    // The helper refuses the planted token, so the skill has to rewrite the Item without it.
    name: "leaked-token",
    fixture: "leaked-token.txt",
    expected: {
      items: { Learnings: [1, 3], Decisions: [1, 2], Todos: [1, 3] },
      mentions: [/fine-grained/i, /revoke/i, /expir/i],
      never: [/ghp_\w{6,}/],
    },
  },
];

export const DUMP_EVAL: Eval = {
  name: "dump",
  model: DRAFTING_MODEL,
  // The `write-dump` checks are inputs too: the skill has to get its body past them.
  inputs: [
    "skills/dump/SKILL.md",
    "skills/dump/item-rules.md",
    "src/dump.ts",
    "src/dump-body.ts",
    "src/secrets.ts",
    "evals/dump.ts",
    "evals/agent.ts",
    "evals/assertions.ts",
    ...new Set(CASES.map(({ fixture }) => `${FIXTURES}/${fixture}`)),
  ],
  cases: CASES.map((dumpCase) => ({ name: dumpCase.name, run: () => runCase(dumpCase) })),
};

async function runCase({ fixture, focus, expected }: DumpCase): Promise<CaseResult> {
  const transcript = readFileSync(join(import.meta.dir, "..", FIXTURES, fixture), "utf8");
  const sandbox = makeSkillSandbox(["dump"]);
  try {
    const session = writeSessionLog(sandbox.project, transcript);
    const reply = await runClaude({
      prompt: focus === undefined ? "/dump" : `/dump ${focus}`,
      cwd: sandbox.project,
      // The skill reads its Item rules from its own folder.
      tools: ["Read", "Bash"],
      allowed: ["Read", "Bash(brain-dump:*)"],
      resume: session.id,
      path: sandbox.path,
    });
    if (!reply.ok) return { failures: [reply.error] };
    const inbox = join(sandbox.vault, INBOX);
    const dumps = existsSync(inbox) ? readdirSync(inbox).filter((name) => name.endsWith(".md")) : [];
    if (dumps.length !== 1) return { failures: [`wrote ${dumps.length} Dumps, expected 1; the skill replied: "${reply.reply.trim().split("\n")[0]}"`] };
    const [name = ""] = dumps;
    const dump = parseDump(name, readFileSync(join(inbox, name), "utf8"));
    if ("problem" in dump) return { failures: [`wrote an unreadable Dump: ${dump.problem}`] };
    const { slug } = dump;
    const body = `${dump.lines.slice(dump.bodyStart).join("\n").trim()}\n`;
    const graded = focus === undefined ? transcript : `${transcript}\n\n[The user then ran \`/dump ${focus}\`.]`;
    return { failures: checkDraft(slug, body, expected), grade: grade(DUMP_RUBRIC, graded, body) };
  } finally {
    removeSkillSandbox(sandbox);
  }
}
