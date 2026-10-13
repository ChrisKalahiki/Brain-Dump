import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareDump, SecretRefusedError } from "../src/dump.ts";
import { BrainDumpError } from "../src/errors.ts";
import type { ChatToolTag } from "../src/origin.ts";
import { CHAT_DUMP_PATH } from "../src/prompts.ts";
import { DRAFTING_MODEL } from "../src/sweep.ts";
import { runClaude, writeSessionLog } from "./agent.ts";
import { checkDraft, type DraftExpectation } from "./assertions.ts";
import type { CaseResult, Eval } from "./eval.ts";
import { DUMP_RUBRIC, grade } from "./rubric.ts";

// The chat prompt, on the pinned model only: it is the chat's saved instructions, a synthetic chat is resumed, and "dump" is sent. The reply is read as
// `dump --paste` reads it and checked as `write-dump` checks it. ChatGPT and Gemini are hand checks.

const FIXTURES = "evals/fixtures/chat-dump";

type ChatCase = { fixture: string; tool: ChatToolTag; expected: DraftExpectation };

const CASES: ChatCase[] = [
  {
    fixture: "citation-setup.txt",
    tool: "ClaudeWeb",
    expected: {
      items: { Learnings: [1, 4], Decisions: [1, 2], Todos: [1, 2] },
      mentions: [/retorque\.re\/zotero-better-bibtex/, /pin/i, /auto-export|keep(?:s)? (?:it )?updated/i, /thesis\.bib|import/i],
      never: [/weather/i],
    },
  },
  {
    fixture: "rate-limit-key.txt",
    tool: "Gemini",
    expected: {
      items: { Learnings: [1, 3], Decisions: [1, 2], Todos: [1, 2] },
      mentions: [/tenacity/, /jitter/i, /rotate/i],
      never: [/sk-[\w-]{6,}/],
    },
  },
];

export const CHAT_DUMP_EVAL: Eval = {
  name: "chat-dump",
  model: DRAFTING_MODEL,
  inputs: [
    "prompts/chat-dump.md",
    "src/dump.ts",
    "src/dump-body.ts",
    "src/secrets.ts",
    "evals/chat-dump.ts",
    "evals/agent.ts",
    "evals/assertions.ts",
    ...CASES.map(({ fixture }) => `${FIXTURES}/${fixture}`),
  ],
  cases: CASES.map((chatCase) => ({ name: chatCase.fixture.replace(/\.txt$/, ""), run: () => runCase(chatCase) })),
};

async function runCase({ fixture, tool, expected }: ChatCase): Promise<CaseResult> {
  const chat = readFileSync(join(import.meta.dir, "..", FIXTURES, fixture), "utf8");
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "brain-dump-eval-")));
  let session: { remove: () => void } | undefined;
  try {
    const { id, remove } = writeSessionLog(folder, chat);
    session = { remove };
    const reply = await runClaude({ prompt: "dump", cwd: folder, tools: [], resume: id, systemPrompt: readFileSync(CHAT_DUMP_PATH, "utf8") });
    if (!reply.ok) return { failures: [reply.error] };
    const pasted = parsePaste(reply.reply);
    if (pasted === undefined) return { failures: [`reply is not a Slug line and a markdown block: "${reply.reply.trim().split("\n")[0]}"`] };
    try {
      prepareDump({ origin: { kind: "chat", tool, chatUrl: undefined, project: undefined, at: new Date("2026-10-05T10:00:00Z") }, slug: pasted.slug, body: pasted.body });
    } catch (error) {
      if (error instanceof SecretRefusedError) return { failures: [`write-dump refused the body: line ${error.line} looks like it holds ${error.kind}`] };
      if (error instanceof BrainDumpError) return { failures: [`invalid body: ${error.message}`] };
      throw error;
    }
    return { failures: checkDraft(pasted.slug, pasted.body, expected), grade: grade(DUMP_RUBRIC, chat, pasted.body) };
  } finally {
    session?.remove();
    rmSync(folder, { recursive: true, force: true });
  }
}

/** The `Slug:` line and the fenced `markdown` block, the two things the chat prompt asks for. */
function parsePaste(reply: string): { slug: string; body: string } | undefined {
  const slug = /^Slug:[ \t]*(\S.*?)[ \t]*$/m.exec(reply)?.[1];
  const body = /^```markdown\n([\s\S]*?)\n```$/m.exec(reply)?.[1];
  return slug === undefined || body === undefined ? undefined : { slug, body: `${body}\n` };
}
