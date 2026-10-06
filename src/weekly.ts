import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { UsageError } from "./errors.ts";
import type { Vault } from "./vault.ts";

const WEEKLY_FOLDER = join("Research", "Weekly Meetings");
export const WEEKLY_TEMPLATE_NOTE = join("Research", "Other", "Templates", "XX-XX-XX Weekly Update.md");
const WEEKLY_NOTE = /^(\d{2})-(\d{2})-(\d{2}) Weekly Update\.md$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export type WeeklyNote = {
  exists: boolean;
  note: string;
};

export function findWeeklyNote(vault: Vault, isoDate: string): WeeklyNote {
  const target = parseIsoDay(isoDate);
  const folder = join(vault.root, WEEKLY_FOLDER);
  const candidates = existsSync(folder) ? readdirSync(folder).flatMap(datedNote) : [];
  const latest = candidates
    .filter(({ day }) => day >= target - 6 && day <= target)
    .sort((a, b) => b.day - a.day)[0];
  if (latest) return { exists: true, note: join(WEEKLY_FOLDER, latest.name) };
  return { exists: false, note: join(WEEKLY_FOLDER, weeklyNoteName(mondayOf(target))) };
}

function datedNote(name: string): { name: string; day: number }[] {
  const match = WEEKLY_NOTE.exec(name);
  if (!match) return [];
  return [{ name, day: dayNumber(2000 + Number(match[3]), Number(match[1]), Number(match[2])) }];
}

function dayNumber(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function mondayOf(day: number): number {
  const weekday = new Date(day * DAY_MS).getUTCDay();
  return day - ((weekday + 6) % 7);
}

function weeklyNoteName(day: number): string {
  const date = new Date(day * DAY_MS);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}-${pad(date.getUTCFullYear() % 100)} Weekly Update.md`;
}

function parseIsoDay(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new UsageError(`--date "${value}" is not a YYYY-MM-DD date`);
  return dayNumber(Number(match[1]), Number(match[2]), Number(match[3]));
}
