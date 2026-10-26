import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { contentHash } from "../src/content-hash.ts";

// What skill evals need of their sandbox Vault: Weekly Note titles dated from today, and a snapshot to prove a run changed nothing.

/** The same local time of day `days` calendar days earlier, so a daylight-saving change between can't move it to another date. */
export function daysBefore(date: Date, days: number): Date {
  const earlier = new Date(date);
  earlier.setDate(date.getDate() - days);
  return earlier;
}

/** `MM-DD-YY Weekly Update`, dated the Monday of the date's local week. */
export function weeklyTitle(date: Date): string {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7));
  const part = (value: number) => String(value).padStart(2, "0");
  return `${part(monday.getMonth() + 1)}-${part(monday.getDate())}-${part(monday.getFullYear() % 100)} Weekly Update`;
}

/** Every file by content hash, and every folder, so a new empty folder counts as a change too. */
export function snapshot(vault: string): Map<string, string> {
  return new Map(
    readdirSync(vault, { recursive: true, withFileTypes: true }).map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return [relative(vault, path), entry.isDirectory() ? "folder" : contentHash(readFileSync(path))];
    }),
  );
}

export function changedFiles(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])].filter((path) => before.get(path) !== after.get(path)).sort();
}
