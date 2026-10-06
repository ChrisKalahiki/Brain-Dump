import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Vault } from "./vault.ts";

export const ROUTES_NOTE = join("Inbox", "Filing Routes.md");
const ROUTE = /^(?:[-*]\s+)?(.+?)\s*→\s*\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*$/;

/** A remembered mapping from a project or subject (`key`) to the title of the note Filing should target. */
export type Route = {
  key: string;
  title: string;
};

export function readRoutes(vault: Vault): Route[] {
  const path = join(vault.root, ROUTES_NOTE);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = ROUTE.exec(line.trim());
      return match?.[1] && match[2] ? [{ key: match[1], title: match[2] }] : [];
    });
}

export function renderRoute({ key, title }: Route): string {
  return `${key} → [[${title}]]`;
}
