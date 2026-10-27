import { basename, join } from "node:path";
import { commit } from "./gateway.ts";
import type { Vault } from "./vault.ts";

// Briefings (ADR 0012): paper-bot's Daily and Weekly notes, written once as opaque Markdown by the Briefing writer.

export type WrittenBriefing = { note: string; run: string };

/** Creates the Briefing at the Vault-relative `note` as one Run. */
export function writeBriefing(vault: Vault, note: string, contents: string): WrittenBriefing {
  const run = commit(vault, "briefing-writer", { command: "write-briefing", label: basename(note, ".md") }, [{ mode: "create", path: join(vault.root, note), contents }]);
  return { note, run };
}
