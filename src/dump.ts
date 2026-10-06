import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDumpBody, renderDumpBody } from "./dump-body.ts";
import { BrainDumpError } from "./errors.ts";
import { formatDateTime, renderOriginLine, type Origin } from "./origin.ts";
import type { Vault } from "./vault.ts";

export function writeDump(vault: Vault, origin: Origin, slug: string, body: string): string {
  const stem = `${formatDateTime(origin.at, "")} ${origin.project} - ${toFilenameSafe(slug)}`;
  const contents = renderDump(origin, renderDumpBody(parseDumpBody(body)));
  for (let copy = 1; ; copy++) {
    const path = join(vault.inbox, `${stem}${copy === 1 ? "" : `-${copy}`}.md`);
    if (createExclusively(path, contents)) return path;
  }
}

const OBSIDIAN_FORBIDDEN = /[*"\\/<>:|?#^[\]]+/g;

function toFilenameSafe(slug: string): string {
  const safe = slug.replace(OBSIDIAN_FORBIDDEN, " ").replace(/\s+/g, " ").trim();
  if (safe === "") throw new BrainDumpError(`slug "${slug}" has no usable characters`);
  return safe;
}

function createExclusively(path: string, contents: string): boolean {
  try {
    writeFileSync(path, contents, { flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

function renderDump(origin: Origin, body: string): string {
  const frontmatter = ["---", "tags:", "  - dump", "  - AIGenerated", `  - ${origin.tool}`, "---"];
  return `${frontmatter.join("\n")}\n${renderOriginLine(origin)}\n\n${body}`;
}
