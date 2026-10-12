import { parseDumpBody, SECTIONS, type SectionName } from "../src/dump-body.ts";
import { toFilenameSafe } from "../src/dump.ts";

// The deterministic checks that gate an eval: a drafted slug and body against what its fixture expects.

export type DraftExpectation = {
  /** Inclusive `[min, max]` Items per kind; `[0, 0]` for a kind the fixture holds none of. */
  items: Record<SectionName, [min: number, max: number]>;
  /** Patterns the body must match, each naming something the fixture makes worth keeping. */
  mentions: RegExp[];
  /** Patterns neither the slug nor the body may match. */
  never: RegExp[];
};

const SLUG_WORDS: [min: number, max: number] = [2, 6];

/** Every way the draft misses its expectation; empty when it passes. The body has already passed `write-dump` validation. */
export function checkDraft(slug: string, body: string, expected: DraftExpectation): string[] {
  const failures: string[] = [];
  const words = slug.split(" ").length;
  if (toFilenameSafe(slug) !== slug || words < SLUG_WORDS[0] || words > SLUG_WORDS[1]) {
    failures.push(`slug "${slug}" is not ${SLUG_WORDS[0]}–${SLUG_WORDS[1]} words safe as a filename`);
  }
  const parsed = parseDumpBody(body);
  for (const kind of SECTIONS) {
    const count = parsed.get(kind)?.length ?? 0;
    const [min, max] = expected.items[kind];
    if (count < min || count > max) failures.push(`${count} ${kind}, expected ${min}–${max}`);
  }
  for (const pattern of expected.mentions) if (!pattern.test(body)) failures.push(`body never mentions ${pattern}`);
  for (const pattern of expected.never) if (pattern.test(slug) || pattern.test(body)) failures.push(`draft contains ${pattern}`);
  return failures;
}
