import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { groupKey } from "./todo-groups.ts";
import type { Vault } from "./vault.ts";

export const ROUTES_NOTE = join("Inbox", "Filing Routes.md");
const NOTE_ROUTE = /^(?:[-*]\s+)?(.+?)\s*→\s*\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*$/;
const GROUP_ROUTE = /^(?:[-*]\s+)?(.+?)\s*→\s*To-Do\s*›\s*(.+?)\s*$/;

/** A remembered mapping from a project or subject (`key`) to the title of the note, or the Todo Group path, Filing should target. */
export type Route = { key: string; title: string } | { key: string; group: string[] };

export function readRoutes(vault: Vault): Route[] {
  const path = join(vault.root, ROUTES_NOTE);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .flatMap((line): Route[] => {
      const note = NOTE_ROUTE.exec(line.trim());
      if (note?.[1] && note[2]) return [{ key: note[1], title: note[2] }];
      const group = GROUP_ROUTE.exec(line.trim());
      if (group?.[1] && group[2]) return [{ key: group[1], group: group[2].split("›").map((name) => name.trim()) }];
      return [];
    });
}

export function renderRoute(route: Route): string {
  return "title" in route ? `${route.key} → [[${route.title}]]` : `${route.key} → To-Do › ${route.group.join(" › ")}`;
}

/** Two Routes are the same when their keys and targets match, group names compared as Todo Groups are matched. */
export function routeIdentity(route: Route): string {
  return "title" in route ? renderRoute(route) : `${route.key}\0group\0${route.group.map(groupKey).join("\0")}`;
}
