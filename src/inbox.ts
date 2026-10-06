import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { parseDumpBody, SECTIONS, type ItemState, type SectionName } from "./dump-body.ts";
import { BrainDumpError } from "./errors.ts";
import type { Vault } from "./vault.ts";

export type ItemKind = "Learning" | "Decision" | "Todo";

const ITEM_KINDS: Record<SectionName, ItemKind> = { Learnings: "Learning", Decisions: "Decision", Todos: "Todo" };
const DUMP_FILENAME = /^(\d{4}-\d{2}-\d{2}) \d{4} (.+?) - .+\.md$/;

export type StoredItem = {
  index: number;
  kind: ItemKind;
  text: string;
  rationale: string | null;
  state: ItemState;
  line: number;
};

export type StoredDump = {
  file: string;
  title: string;
  date: string;
  project: string;
  items: StoredItem[];
  lines: string[];
  eol: string;
};

export function listUnfiledDumps(vault: Vault): StoredDump[] {
  return readdirSync(vault.inbox)
    .filter((name) => DUMP_FILENAME.test(name))
    .sort()
    .map((name) => readDump(vault, join(vault.inbox, name)))
    .filter((dump) => dump.items.some((item) => item.state === "open"));
}

export function readDump(vault: Vault, path: string): StoredDump {
  const name = basename(path);
  const match = DUMP_FILENAME.exec(name);
  if (!match?.[1] || !match[2]) throw new BrainDumpError(`${name} is not a Dump`);
  const contents = readFileSync(path, "utf8");
  const eol = contents.includes("\r\n") ? "\r\n" : "\n";
  const lines = contents.split(eol);
  const bodyStart = lines.findIndex((line) => line.startsWith("## "));
  if (bodyStart === -1) throw new BrainDumpError(`${name} has no Items`);
  const body = parseDumpBody(lines.slice(bodyStart).join("\n"), { stored: true });
  let index = 0;
  const items = SECTIONS.flatMap((section) =>
    (body.get(section) ?? []).map((item) => ({
      index: ++index,
      kind: ITEM_KINDS[section],
      text: item.text,
      rationale: item.rationale ?? null,
      state: item.state,
      line: bodyStart + item.line,
    })),
  );
  return { file: relative(vault.root, path), title: name.slice(0, -3), date: match[1], project: match[2], items, lines, eol };
}

export type DumpSummary = Omit<StoredDump, "lines" | "items" | "eol"> & { items: Omit<StoredItem, "line">[] };

export function summarize({ lines, items, eol, ...dump }: StoredDump): DumpSummary {
  return { ...dump, items: items.map(({ line, ...item }) => item) };
}
