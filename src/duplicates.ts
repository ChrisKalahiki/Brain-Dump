import { itemKey } from "./curated.ts";
import { summarize, type DumpSummary, type StoredDump, type StoredItem } from "./inbox.ts";
import { readVaultItems, type VaultItem } from "./vault-items.ts";
import type { Vault } from "./vault.ts";

// Near-duplicate Items: word overlap only, with no index, embeddings or agent judgement (ADR 0007). The flag is advisory, so a missed paraphrase costs little.

const MATCH_AT = 0.7;
const MIN_WORDS = 3;
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const DONE = /^\[[xX]\] /;
const DROPPED = /^\[-\] /;
const STOPWORDS = new Set(
  (
    "a about after all also am an and any are as at be been before being both but by can could did do does each for from had has have having he her here him his how i if in into is it its it's " +
    "just me more most my no nor not of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too " +
    "under until up very was we were what when where which while who whom why will with would you your"
  ).split(" "),
);

/** The best match for an open Item: an Item in a curated note, or an open Item of another Inbox Dump (`note` is then that Dump's file). */
export type Similar = { note: string; text: string; score: number; done: boolean };

export type ListedDump = Omit<DumpSummary, "items"> & { items: (DumpSummary["items"][number] & { similar?: Similar })[] };

export type NearDuplicateFinder = (dump: StoredDump, item: StoredItem) => Similar | undefined;

type Candidate = Omit<Similar, "score"> & { words: Set<string> };

/** Compares an open Item against the allowlist's filed Items and the other Inbox Dumps' open Items. Dropped Items never match. */
export function nearDuplicateFinder(items: VaultItem[]): NearDuplicateFinder {
  const candidates: Candidate[] = items
    .filter(({ state, text }) => state === "open" || !DROPPED.test(text))
    .map(({ note, text, state }) => ({ note, text, done: state === "filed" && DONE.test(text), words: wordSet(text) }))
    .filter(({ words }) => words.size >= MIN_WORDS);
  return (dump, item) => {
    const words = wordSet(item.text);
    if (item.state !== "open" || words.size < MIN_WORDS) return undefined;
    let best: Similar | undefined;
    for (const { words: other, ...candidate } of candidates) {
      if (candidate.note === dump.file) continue;
      const score = jaccard(words, other);
      if (score >= MATCH_AT && score > (best?.score ?? 0)) best = { ...candidate, score };
    }
    return best && { ...best, score: Math.round(best.score * 100) / 100 };
  };
}

/** list-dumps: every unfiled Dump, each open Item with its nearest duplicate as `similar`, absent when nothing matches. */
export function listDumps(vault: Vault, inbox: StoredDump[]): ListedDump[] {
  const nearest = nearDuplicateFinder(readVaultItems(vault).items);
  return inbox.map((dump) => ({
    ...summarize(dump),
    items: dump.items.map((item) => {
      const { line, ...listed } = item;
      const similar = nearest(dump, item);
      return similar === undefined ? listed : { ...listed, similar };
    }),
  }));
}

/** Normalised as `check` does, then split into words without stopwords. */
function wordSet(text: string): Set<string> {
  return new Set((itemKey(text).match(WORD) ?? []).filter((word) => !STOPWORDS.has(word)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / (a.size + b.size - shared);
}
