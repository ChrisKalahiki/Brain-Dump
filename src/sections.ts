const HEADING = /^(#+) /;

/** The lines of a `#`-heading section: `start` is the heading, `end` the first line after it (a `---`, an equal-or-higher heading, or the end of the note). */
export type SectionBounds = { start: number; end: number };

export function findSection(lines: string[], section: string): SectionBounds | undefined {
  const start = lines.findIndex((candidate) => isHeading(candidate, section));
  if (start === -1) return undefined;
  const level = HEADING.exec(lines[start] ?? "")?.[1]?.length ?? 1;
  let end = start + 1;
  while (end < lines.length && !endsSection(lines[end] ?? "", level)) end++;
  return { start, end };
}

function isHeading(line: string, section: string): boolean {
  const trimmed = line.trim();
  return HEADING.test(trimmed) && (trimmed === section || trimmed.startsWith(`${section} `));
}

function endsSection(line: string, level: number): boolean {
  const heading = HEADING.exec(line);
  return line.trim() === "---" || (heading?.[1] !== undefined && heading[1].length <= level);
}
