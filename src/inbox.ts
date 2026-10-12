import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { readHashed } from "./content-hash.ts";
import { parseDumpBody, SECTIONS, type ItemState, type SectionName } from "./dump-body.ts";
import { BrainDumpError } from "./errors.ts";
import { FILED_FOLDER, INBOX } from "./layout.ts";
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
  hash: string;
};

export function isDumpFile(path: string): boolean {
  return DUMP_FILENAME.test(basename(path));
}

/** A Dump in the Inbox or, once finished, in Inbox/Filed. */
export function isStoredDump(vault: Vault, path: string): boolean {
  const folder = relative(vault.root, dirname(path));
  return isDumpFile(path) && (folder === INBOX || folder === FILED_FOLDER);
}

export function listUnfiledDumps(vault: Vault): StoredDump[] {
  return readdirSync(vault.inbox)
    .filter(isDumpFile)
    .sort()
    .map((name) => readDump(vault, join(vault.inbox, name)))
    .filter((dump) => dump.items.some((item) => item.state === "open"));
}

export function readDump(vault: Vault, path: string): StoredDump {
  const name = basename(path);
  const match = DUMP_FILENAME.exec(name);
  if (!match?.[1] || !match[2]) throw new BrainDumpError(`${name} is not a Dump`);
  const { contents, hash } = readHashed(path);
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
  return { file: relative(vault.root, path), title: name.slice(0, -3), date: match[1], project: match[2], items, lines, eol, hash };
}

/** A Dump `readDump` can't parse, left for `check` to report rather than breaking other commands. */
export type MalformedDump = { file: string; problem: string };

export function readDumpOrProblem(vault: Vault, path: string): StoredDump | MalformedDump {
  try {
    return readDump(vault, path);
  } catch (error) {
    if (error instanceof BrainDumpError) return { file: relative(vault.root, path), problem: error.message };
    throw error;
  }
}

export type DumpSummary = Omit<StoredDump, "lines" | "items" | "eol"> & { items: Omit<StoredItem, "line">[] };

export function summarize({ lines, items, eol, ...dump }: StoredDump): DumpSummary {
  return { ...dump, items: items.map(({ line, ...item }) => item) };
}

/** Each Session a Dump in `Inbox/` or `Inbox/Filed/` covers, through the latest `through` among its Dumps. */
export function coveredSessions(vault: Vault): Map<string, Date> {
  const covered = new Map<string, Date>();
  for (const folder of [INBOX, FILED_FOLDER].map((name) => join(vault.root, name))) {
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder).filter(isDumpFile)) {
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(join(folder, name), "utf8"))?.[1] ?? "";
      const session = /^session: (\S+)$/m.exec(frontmatter)?.[1];
      const through = new Date(/^through: (\S+)$/m.exec(frontmatter)?.[1] ?? "");
      const known = session === undefined ? undefined : covered.get(session);
      if (session !== undefined && !Number.isNaN(through.getTime()) && (known === undefined || through > known)) covered.set(session, through);
    }
  }
  return covered;
}
