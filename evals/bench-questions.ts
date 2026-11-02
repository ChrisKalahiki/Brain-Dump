// The benchmark's question files: one `<question> → [[Note#Section]]` per line, the hand-written `questions.txt` and the two generated sets alike.
// A link with no Section, `[[Note]]`, is scored at note level.

const ARROW = "→";
const LINK = /^\[\[[^\]]+\]\]$/;

/** `line` is 1-based; `gold` is the link as written, resolved through `show` before scoring. */
export type BenchQuestion = { line: number; question: string; gold: string };

export type ParsedQuestions = { questions: BenchQuestion[]; malformed: { line: number; error: string }[] };

/** The last `→` on a line splits it, so a question may contain one. */
export function parseQuestions(text: string): ParsedQuestions {
  const parsed: ParsedQuestions = { questions: [], malformed: [] };
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = index + 1;
    if (raw.trim() === "") continue;
    const arrow = raw.lastIndexOf(ARROW);
    const question = raw.slice(0, Math.max(0, arrow)).trim();
    const gold = raw.slice(arrow + ARROW.length).trim();
    if (arrow === -1) parsed.malformed.push({ line, error: `no ${ARROW} between the question and its [[Note#Section]]` });
    else if (question === "") parsed.malformed.push({ line, error: `no question before ${ARROW}` });
    else if (!LINK.test(gold)) parsed.malformed.push({ line, error: `after ${ARROW} comes ${gold}, not one [[Note#Section]]` });
    else parsed.questions.push({ line, question, gold });
  }
  return parsed;
}

export function renderQuestion(question: string, gold: string): string {
  return `${question.replace(/\s+/g, " ").trim()} ${ARROW} ${gold}`;
}

const GENERATED_LINE = /^\W*([IS]\d+):\s*(.+?)\s*$/;

/** The generator answers `I<n>: <question>` per Item and `S<n>: <question>` per Section, in any order; any other line is ignored. */
export function parseGenerated(reply: string): Map<string, string[]> {
  const generated = new Map<string, string[]>();
  for (const line of reply.split(/\r?\n/)) {
    const [, key, question] = GENERATED_LINE.exec(line) ?? [];
    if (key !== undefined && question !== undefined) generated.set(key, [...(generated.get(key) ?? []), question]);
  }
  return generated;
}
