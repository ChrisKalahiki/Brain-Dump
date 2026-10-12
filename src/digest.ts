import { FROM_LINE } from "./curated.ts";

// A Digest (ADR 0008): a `> [!summary] Digest MM-DD-YY` callout at a note's end, closed by its `^digest-MMDDYY` ID line, covering everything above it.

const DIGEST_ID = /^\^digest-(\d{6})(?:-(\d+))?\s*$/;

/** The note's latest Digest ID, without its `^`, and the filed Items after its ID line, or in the whole note when it has none. */
export function sinceLatestDigest(lines: string[]): { latest: string | undefined; filed: number } {
  const index = lines.findLastIndex((line) => DIGEST_ID.test(line.trim()));
  const filed = lines.slice(index + 1).filter((line) => FROM_LINE.test(line.trim())).length;
  return { latest: index === -1 ? undefined : lines[index]?.trim().slice(1), filed };
}

/** The `nth` Digest a note gets on `day` (1 for the first): its ID without `^`, and the title its callout shows. */
export function digestName(day: Date, nth: number): { id: string; title: string } {
  const [year, month, date] = [day.getFullYear() % 100, day.getMonth() + 1, day.getDate()].map((part) => String(part).padStart(2, "0"));
  return {
    id: `digest-${month}${date}${year}${nth === 1 ? "" : `-${nth}`}`,
    title: `Digest ${month}-${date}-${year}${nth === 1 ? "" : ` (${nth})`}`,
  };
}

/** How many Digests the note already has from `day`'s IDs, so the next is numbered after them. */
export function digestsOn(lines: string[], day: Date): number {
  const stamp = digestName(day, 1).id.slice("digest-".length);
  return Math.max(0, ...lines.map((line) => DIGEST_ID.exec(line.trim())).flatMap((match) => (match?.[1] === stamp ? [Number(match[2] ?? 1)] : [])));
}
