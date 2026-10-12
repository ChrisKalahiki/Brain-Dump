import { basename, relative } from "node:path";
import { countOf } from "./check.ts";
import { now } from "./clock.ts";
import { readHashed } from "./content-hash.ts";
import { digestName, digestsOn, sinceLatestDigest } from "./digest.ts";
import { BrainDumpError, UsageError } from "./errors.ts";
import { isRecord } from "./filing.ts";
import { commit } from "./gateway.ts";
import { INBOX, WEEKLY_FOLDER } from "./layout.ts";
import { findNote } from "./show.ts";
import type { Vault } from "./vault.ts";

// Consolidation (ADR 0008): the skill drafts a Digest's theme bullets; the helper names, numbers and places it, appending it as one Run.

const MIN_BULLETS = 3;
const MAX_BULLETS = 10;
const PLAN_SHAPE = `expected {"expect": {[path: string]: string}, "bullets": string[]} with ${MIN_BULLETS} to ${MAX_BULLETS} one-line bullets, none starting with "- "`;

export type ConsolidationPlan = { expect: Record<string, string>; bullets: string[] };

/** `lines` is the Digest exactly as appended; `run` is set once it is written. */
export type Consolidation = { note: string; digest: string; supersedes: string | null; items: number; lines: string[]; run?: string };

export function parseConsolidationPlan(text: string): ConsolidationPlan {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new UsageError("invalid consolidation plan: stdin is not JSON");
  }
  if (!isConsolidationPlan(value)) throw new UsageError(`invalid consolidation plan: ${PLAN_SHAPE}`);
  return value;
}

/** Without `confirm`, checks the plan and returns the Digest it would append, writing nothing. */
export function consolidate(vault: Vault, name: string, plan: ConsolidationPlan, { confirm = false } = {}): Consolidation {
  const path = findNote(vault, name);
  const note = relative(vault.root, path);
  if (note.startsWith(`${WEEKLY_FOLDER}/`) || note.startsWith(`${INBOX}/`)) {
    throw new BrainDumpError(`${note} is ${note.startsWith(`${INBOX}/`) ? "in the Inbox" : "a Weekly Note"}, and only Topic Notes and Project Notes take a Digest`);
  }
  const expected = plan.expect[note];
  if (expected === undefined) throw new BrainDumpError(`Consolidation plan rejected: expect has no hash for ${note}`);
  const { contents, hash } = readHashed(path);
  if (hash !== expected) throw new BrainDumpError(`Consolidation plan stale: ${note} changed since it was read`);

  const eol = contents.includes("\r\n") ? "\r\n" : "\n";
  const lines = contents.split(eol);
  const { latest, filed } = sinceLatestDigest(lines);
  if (filed === 0) throw new BrainDumpError(latest === undefined ? `${note} has no filed Item to consolidate` : `${note} has no filed Item since ^${latest}`);
  const day = now();
  const { id, title } = digestName(day, digestsOn(lines, day) + 1);
  const digest = [
    `> [!summary] ${title}`,
    ...(latest === undefined ? [] : [`> Supersedes [[#^${latest}]] · ${countOf(filed, "Item")}`]),
    ...plan.bullets.map((bullet) => `> - ${bullet}`),
    `^${id}`,
  ];
  const consolidation: Consolidation = { note, digest: `^${id}`, supersedes: latest === undefined ? null : `^${latest}`, items: filed, lines: digest };
  if (!confirm) return consolidation;

  const separator = contents.endsWith(`${eol}${eol}`) ? "" : contents.endsWith(eol) ? eol : `${eol}${eol}`;
  const run = commit(vault, "approved-plan", { command: "consolidate", label: basename(note, ".md") }, [{ mode: "append", path, contents: `${contents}${separator}${digest.join(eol)}${eol}` }]);
  return { ...consolidation, run };
}

function isConsolidationPlan(value: unknown): value is ConsolidationPlan {
  if (!isRecord(value)) return false;
  const { expect, bullets } = value;
  const expectOk = isRecord(expect) && Object.values(expect).every((hash) => typeof hash === "string");
  return expectOk && Array.isArray(bullets) && bullets.length >= MIN_BULLETS && bullets.length <= MAX_BULLETS && bullets.every(isBullet);
}

function isBullet(bullet: unknown): boolean {
  return typeof bullet === "string" && bullet.trim() !== "" && !/[\r\n]/.test(bullet) && !bullet.startsWith("- ");
}
