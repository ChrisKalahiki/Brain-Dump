import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseDumpBody, SECTIONS, type ItemState, type SectionName } from "./dump-body.ts";
import { BrainDumpError } from "./errors.ts";
import type { Vault } from "./vault.ts";

const ITEM_KINDS: Record<SectionName, string> = { Learnings: "Learning", Decisions: "Decision", Todos: "Todo" };
const DUMP_FILENAME = /^(\d{4}-\d{2}-\d{2}) \d{4} (.+?) - .+\.md$/;

export type StoredItem = {
  index: number;
  kind: string;
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
};

export function listUnfiledDumps(vault: Vault): StoredDump[] {
  return readdirSync(vault.inbox)
    .filter((name) => DUMP_FILENAME.test(name))
    .sort()
    .map((name) => readDump(vault, join(vault.inbox, name)))
    .filter((dump) => dump.items.some((item) => item.state === "open"));
}

export function readDump(vault: Vault, path: string): StoredDump {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const match = DUMP_FILENAME.exec(name);
  if (!match?.[1] || !match[2]) throw new BrainDumpError(`${name} is not a Dump`);
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
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
  return { file: relative(vault.root, path), title: name.slice(0, -3), date: match[1], project: match[2], items, lines };
}

export type DumpSummary = Omit<StoredDump, "lines" | "items"> & { items: Omit<StoredItem, "line">[] };

export function summarize({ lines, items, ...dump }: StoredDump): DumpSummary {
  return { ...dump, items: items.map(({ line, ...item }) => item) };
}
