import { dirname } from "node:path";
import { curatedBullets, curatedNotes, itemKey, type CuratedNote } from "./curated.ts";
import { isStoredDump, readDumpOrProblem, type MalformedDump, type StoredDump } from "./inbox.ts";
import { INBOX } from "./layout.ts";
import { noteFiles, titleKey } from "./notes.ts";
import type { Vault } from "./vault.ts";

// Every Item in the allowlist with its state, source Dump and identity, read in one pass, so no reader joins Dumps to filed Items itself.

/** `open`: still unfiled in an Inbox Dump. `filed`: in a curated note, its `text` keeping any checkbox. */
export type VaultItem = {
  /** The Vault-relative path of the note holding it: its Dump while open, the curated note once filed. */
  note: string;
  text: string;
  rationale: string | null;
  state: "open" | "filed";
  /** The Dump it came from: by its backlink, or for a filed Item without one, the one Dump that filed the same text. */
  dump: StoredDump | undefined;
  backlinked: boolean;
  /** `itemKey` of its text, the same before and after Filing. */
  key: string;
  /** 0-based, in `note`. */
  line: number;
};

/** What the Items were read from, for callers that also look at whole notes and Dumps. `files` is every note in the allowlist. */
export type VaultItems = { items: VaultItem[]; dumps: StoredDump[]; malformed: MalformedDump[]; notes: CuratedNote[]; files: string[] };

/** Filed Items first, in note path and place order, then open Items the same way. A Malformed Dump holds no Items. */
export function readVaultItems(vault: Vault): VaultItems {
  const files = noteFiles(vault);
  const dumps: StoredDump[] = [];
  const malformed: MalformedDump[] = [];
  for (const path of files.filter((file) => isStoredDump(vault, file))) {
    const dump = readDumpOrProblem(vault, path);
    if ("problem" in dump) malformed.push(dump);
    else dumps.push(dump);
  }
  const notes = curatedNotes(vault);
  const byTitle = new Map(dumps.map((dump) => [titleKey(dump.title), dump]));
  const byFiledTodo = filedTodoDumps(dumps);
  const filed = notes.flatMap(({ note, lines }) =>
    curatedBullets(lines).map(({ text, why, from, line }): VaultItem => {
      const key = itemKey(text);
      const dump = from === undefined ? (byFiledTodo.get(key) ?? undefined) : byTitle.get(titleKey(from));
      return { note, text, rationale: why ?? null, state: "filed", dump, backlinked: from !== undefined, key, line };
    }),
  );
  const open = dumps
    .filter((dump) => dirname(dump.file) === INBOX)
    .flatMap((dump) =>
      dump.items
        .filter((item) => item.state === "open")
        .map((item): VaultItem => ({ note: dump.file, text: item.text, rationale: item.rationale, state: "open", dump, backlinked: false, key: itemKey(item.text), line: item.line })),
    );
  return { items: [...filed, ...open], dumps, malformed, notes, files };
}

/** A filed Todo has no backlink, so its Dump is the one Dump that filed the same text; `null` when several did. */
function filedTodoDumps(dumps: StoredDump[]): Map<string, StoredDump | null> {
  const byText = new Map<string, StoredDump | null>();
  for (const dump of dumps) {
    for (const item of dump.items) {
      if (item.kind !== "Todo" || item.state !== "filed") continue;
      const key = itemKey(item.text);
      byText.set(key, byText.has(key) && byText.get(key)?.file !== dump.file ? null : dump);
    }
  }
  return byText;
}
