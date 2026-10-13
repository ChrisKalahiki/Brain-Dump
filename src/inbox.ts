import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { readHashed } from "./content-hash.ts";
import { SECTIONS, type ItemState, type SectionName } from "./dump-body.ts";
import { coveredSession, isDumpFile, parseDump, type ParsedDump } from "./dump.ts";
import { BrainDumpError } from "./errors.ts";
import { FILED_FOLDER, INBOX } from "./layout.ts";
import type { Vault } from "./vault.ts";

export type ItemKind = "Learning" | "Decision" | "Todo";

const ITEM_KINDS: Record<SectionName, ItemKind> = { Learnings: "Learning", Decisions: "Decision", Todos: "Todo" };

export type StoredItem = {
  index: number;
  kind: ItemKind;
  text: string;
  rationale: string | null;
  state: ItemState;
  line: number;
};

export type StoredDump = Pick<ParsedDump, "origin" | "swept" | "date" | "label" | "lines" | "eol"> & {
  file: string;
  title: string;
  /** The Project its origin line names; a chat Dump may name none. */
  project: string | null;
  items: StoredItem[];
  hash: string;
};

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
  const dump = readDumpOrProblem(vault, path);
  if ("problem" in dump) throw new BrainDumpError(`${dump.file}: ${dump.problem}`);
  return dump;
}

/** A Dump `parseDump` can't read, left for `check` to report rather than breaking other commands. */
export type MalformedDump = { file: string; problem: string };

export function readDumpOrProblem(vault: Vault, path: string): StoredDump | MalformedDump {
  const file = relative(vault.root, path);
  const { contents, hash } = readHashed(path);
  const parsed = parseDump(path, contents);
  if ("problem" in parsed) return { file, problem: parsed.problem };
  const { origin, swept, date, label, body, bodyStart, lines, eol } = parsed;
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
  return { file, title: basename(path, ".md"), date, label, project: origin.project ?? null, origin, swept, items, lines, eol, hash };
}

export type DumpSummary = Pick<StoredDump, "file" | "title" | "date" | "project" | "label" | "hash"> & { items: Omit<StoredItem, "line">[] };

export function summarize({ file, title, date, project, label, hash, items }: StoredDump): DumpSummary {
  return { file, title, date, project, label, hash, items: items.map(({ line, ...item }) => item) };
}

/** Each Session a Dump in `Inbox/` or `Inbox/Filed/` covers, through the latest `through` among its Dumps. */
export function coveredSessions(vault: Vault): Map<string, Date> {
  const covered = new Map<string, Date>();
  for (const folder of [INBOX, FILED_FOLDER].map((name) => join(vault.root, name))) {
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder).filter(isDumpFile)) {
      const session = coveredSession(readFileSync(join(folder, name), "utf8"));
      const known = session === undefined ? undefined : covered.get(session.id);
      if (session !== undefined && (known === undefined || session.through > known)) covered.set(session.id, session.through);
    }
  }
  return covered;
}
