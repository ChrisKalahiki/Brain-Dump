// Scoring the benchmark: each answer is resolved through `show` first, so names compare as #130 resolves them and an invented Section is one `show` refuses.

const ANSWERS = 3;

/** A name `show` resolved: `section` is its canonical `[[Note#Section]]`, or null for a whole note. */
export type Resolved = { note: string; section: string | null };

/** `answers` are in the candidate's order; `outlineChars` is every character of Outline the question's calls sent. */
export type Answered = { gold: Resolved; answers: (Resolved | "refused")[]; outlineChars: number };

export type Score = { questions: number; recallAt1: number; recallAt3: number; invented: number; outlineChars: { mean: number; max: number } };

export function score(answered: Answered[]): Score {
  const hitWithin = (k: number): number => share(answered.filter(({ gold, answers }) => answers.slice(0, k).some((answer) => answer !== "refused" && hits(gold, answer))).length, answered.length);
  const answers = answered.flatMap(({ answers }) => answers);
  const chars = answered.map(({ outlineChars }) => outlineChars);
  return {
    questions: answered.length,
    recallAt1: hitWithin(1),
    recallAt3: hitWithin(ANSWERS),
    invented: share(answers.filter((answer) => answer === "refused").length, answers.length),
    outlineChars: { mean: Math.round(share(chars.reduce((sum, n) => sum + n, 0), chars.length)), max: Math.max(0, ...chars) },
  };
}

/** The distinct `[[…]]` links in a reply, in order, at most three. */
export function answerLinks(reply: string): string[] {
  return [...new Set([...reply.matchAll(/\[\[[^\]\n]+\]\]/g)].map(([link]) => link))].slice(0, ANSWERS);
}

function hits(gold: Resolved, answer: Resolved): boolean {
  return answer.note === gold.note && (gold.section === null || answer.section === gold.section);
}

function share(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}
