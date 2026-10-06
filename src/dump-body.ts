import { BrainDumpError } from "./errors.ts";

export const SECTIONS = ["Learnings", "Decisions", "Todos"] as const;

export type SectionName = (typeof SECTIONS)[number];

export type Item = {
  text: string;
  rationale: string | undefined;
};

export type DumpBody = Map<SectionName, Item[]>;

const ITEM = /^- \[ \] (.+)$/;
const RATIONALE_LINE = /^(?:\t| {2,})- Why: (.+)$/;

export function parseDumpBody(text: string): DumpBody {
  const body: DumpBody = new Map();
  let section: SectionName | undefined;
  let items: Item[] | undefined;
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      const name = SECTIONS.find((candidate) => candidate === heading[1]);
      if (name === undefined) invalid(`unexpected section "${line}"`);
      const previous = section === undefined ? -1 : SECTIONS.indexOf(section);
      if (SECTIONS.indexOf(name) <= previous) {
        invalid(`sections must appear once each, in the order ${SECTIONS.join(", ")}`);
      }
      section = name;
      items = [];
      body.set(name, items);
      continue;
    }
    const item = ITEM.exec(line);
    if (item?.[1] && items) {
      items.push({ text: item[1], rationale: undefined });
      continue;
    }
    const rationale = RATIONALE_LINE.exec(line);
    const last = items?.at(-1);
    if (rationale?.[1] && section === "Decisions" && last && last.rationale === undefined) {
      last.rationale = rationale[1];
      continue;
    }
    invalid(`line ${index + 1} is not an Item: "${line}"`);
  }
  if (body.size === 0) invalid("it has no Items");
  for (const [name, sectionItems] of body) {
    if (sectionItems.length === 0) invalid(`section "## ${name}" has no Items`);
  }
  for (const decision of body.get("Decisions") ?? []) {
    if (decision.rationale === undefined) invalid(`Decision "${decision.text}" has no "\\t- Why:" line`);
  }
  for (const todo of body.get("Todos") ?? []) {
    if (!/(^|\s)#todo(\s|$)/.test(todo.text)) invalid(`Todo "${todo.text}" has no #todo tag`);
  }
  return body;
}

export function renderDumpBody(body: DumpBody): string {
  const sections = SECTIONS.flatMap((name) => {
    const items = body.get(name);
    if (!items) return [];
    const lines = items.flatMap((item) =>
      item.rationale === undefined ? [`- [ ] ${item.text}`] : [`- [ ] ${item.text}`, `\t- Why: ${item.rationale}`],
    );
    return [[`## ${name}`, ...lines].join("\n")];
  });
  return `${sections.join("\n\n")}\n`;
}

function invalid(reason: string): never {
  throw new BrainDumpError(`invalid Dump body: ${reason}`);
}
