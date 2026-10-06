import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDumpBody, renderDumpBody } from "./dump-body.ts";
import { BrainDumpError, describeFsError, DumpNotWrittenError, errnoCode, UsageError } from "./errors.ts";
import { dumpStem, renderOriginLine, type Origin } from "./origin.ts";
import { locateVault } from "./vault.ts";

const OBSIDIAN_FORBIDDEN = /[*"\\/<>:|?#^[\]]+/g;

export function writeDump(origin: Origin, slug: string, body: string): string {
  const stem = `${dumpStem(origin)} - ${toFilenameSafe(slug)}`;
  const contents = renderDump(origin, renderDumpBody(parseDumpBody(body)));
  try {
    const { inbox } = locateVault();
    return createWithFreeName(inbox, stem, contents);
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

function createWithFreeName(inbox: string, stem: string, contents: string): string {
  for (let copy = 1; ; copy++) {
    const path = join(inbox, `${stem}${copy === 1 ? "" : `-${copy}`}.md`);
    try {
      writeFileSync(path, contents, { flag: "wx" });
      return path;
    } catch (error) {
      if (errnoCode(error) === "EEXIST") continue;
      throw new BrainDumpError(`cannot write the Dump into ${inbox}: ${describeFsError(error)}`);
    }
  }
}

function renderDump(origin: Origin, body: string): string {
  const frontmatter = ["---", "tags:", "  - dump", "  - AIGenerated", `  - ${origin.tool}`, "---"];
  return `${frontmatter.join("\n")}\n${renderOriginLine(origin)}\n\n${body}`;
}
