import { FROM_LINE } from "./curated.ts";

// A Digest (ADR 0008): a `> [!summary] Digest MM-DD-YY` callout at a note's end, closed by its `^digest-MMDDYY` ID line, covering everything above it.

const DIGEST_HEADER = /^> \[!summary\] Digest \d{2}-\d{2}-\d{2}(?: \(\d+\))?\s*$/;
const DIGEST_ID = /^\^digest-(\d{6})(?:-(\d+))?\s*$/;

/** A Digest's place in its note's lines: its header line, and its ID line with the `^` ID it holds. */
export type DigestBounds = { header: number; end: number; id: string };

/** The last Digest whose ID line closes a callout opened by a Digest header, so a stray ID or an unclosed header doesn't count. */
export function latestDigest(lines: string[]): DigestBounds | undefined {
  for (let end = lines.length - 1; end >= 0; end--) {
    const id = lines[end]?.trim() ?? "";
    if (!DIGEST_ID.test(id)) continue;
    let header = end - 1;
    while (header >= 0 && lines[header]?.trim() === "") header--;
    while (header > 0 && lines[header]?.startsWith(">") && !DIGEST_HEADER.test(lines[header] ?? "")) header--;
    if (DIGEST_HEADER.test(lines[header] ?? "")) return { header, end, id };
  }
  return undefined;
}

/** The note's latest Digest ID and the filed Items after its ID line, or in the whole note when it has none. */
export function sinceLatestDigest(lines: string[]): { latest: string | undefined; filed: number } {
  const digest = latestDigest(lines);
  const filed = lines.slice((digest?.end ?? -1) + 1).filter((line) => FROM_LINE.test(line.trim())).length;
  return { latest: digest?.id, filed };
}

/** The `nth` Digest a note gets on `day` (1 for the first): its `^` ID, and the title its callout shows. */
export function digestName(day: Date, nth: number): { id: string; title: string } {
  const [year, month, date] = [day.getFullYear() % 100, day.getMonth() + 1, day.getDate()].map((part) => String(part).padStart(2, "0"));
  return {
    id: `^digest-${month}${date}${year}${nth === 1 ? "" : `-${nth}`}`,
    title: `Digest ${month}-${date}-${year}${nth === 1 ? "" : ` (${nth})`}`,
  };
}

/** The highest number among the note's Digest IDs from `day` (a bare ID is 1), or 0 when it has none, so the next is numbered after it. */
export function latestOrdinalOn(lines: string[], day: Date): number {
  const stamp = digestName(day, 1).id.slice("^digest-".length);
  return Math.max(0, ...lines.map((line) => DIGEST_ID.exec(line.trim())).flatMap((match) => (match?.[1] === stamp ? [Number(match[2] ?? 1)] : [])));
}
