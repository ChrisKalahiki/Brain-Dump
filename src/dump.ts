import { join } from "node:path";
import { parseDumpBody, renderDumpBody } from "./dump-body.ts";
import { BrainDumpError, DumpNotWrittenError, UsageError } from "./errors.ts";
import { commit, NoteExistsError, WriteFailedError } from "./gateway.ts";
import { dumpStem, renderOriginLine, type Origin } from "./origin.ts";
import { locateVault, type Vault } from "./vault.ts";

const OBSIDIAN_FORBIDDEN = /[*"\\/<>:|?#^[\]]+/g;

export function writeDump(origin: Origin, slug: string, body: string): string {
  const stem = `${dumpStem(origin)} - ${toFilenameSafe(slug)}`;
  const contents = renderDump(origin, renderDumpBody(parseDumpBody(body)));
  try {
    return createWithFreeName(locateVault(), stem, contents);
  } catch (error) {
    if (error instanceof BrainDumpError) throw new DumpNotWrittenError(error.message, contents);
    throw error;
  }
}

function toFilenameSafe(slug: string): string {
  const safe = slug.replace(OBSIDIAN_FORBIDDEN, " ").replace(/\s+/g, " ").trim();
  if (safe === "") throw new UsageError(`--slug "${slug}" has no usable characters`);
  return safe;
}

function createWithFreeName(vault: Vault, stem: string, contents: string): string {
  for (let copy = 1; ; copy++) {
    const path = join(vault.inbox, `${stem}${copy === 1 ? "" : `-${copy}`}.md`);
    try {
      commit(vault, "automation", [{ mode: "create", path, contents }]);
      return path;
    } catch (error) {
      if (error instanceof NoteExistsError) continue;
      if (error instanceof WriteFailedError) throw new BrainDumpError(`cannot write the Dump into ${vault.inbox}: ${error.reason}`);
      throw error;
    }
  }
}

function renderDump(origin: Origin, body: string): string {
  const frontmatter = ["---", "tags:", "  - dump", "  - AIGenerated", `  - ${origin.tool}`, "---"];
  return `${frontmatter.join("\n")}\n${renderOriginLine(origin)}\n\n${body}`;
}
