import { basename, join } from "node:path";
import { parseDumpBody, renderDumpBody } from "./dump-body.ts";
import { BrainDumpError, DumpNotWrittenError, UsageError } from "./errors.ts";
import { commit, NoteExistsError, WriteFailedError } from "./gateway.ts";
import { dumpStem, renderOriginLine, type Origin } from "./origin.ts";
import { findSecret } from "./secrets.ts";
import { locateVault, type Vault } from "./vault.ts";

const OBSIDIAN_FORBIDDEN = /[*"\\/<>:|?#^[\]]+/g;

/** The tool's own id for the Session a Dump covers, and the time of the last record it covers. */
export type CoveredSession = { id: string; through: Date };

export function writeDump(origin: Origin, slug: string, body: string, session?: CoveredSession): string {
  const stem = `${dumpStem(origin)} - ${toFilenameSafe(slug)}`;
  const secret = findSecret(body);
  if (secret !== undefined) throw new BrainDumpError(`Dump refused: line ${secret.line} looks like it holds ${secret.kind}; remove it and write the Dump again`);
  const contents = renderDump(origin, renderDumpBody(parseDumpBody(body)), session);
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
      commit(vault, "automation", { command: "write-dump", label: basename(path, ".md") }, [{ mode: "create", path, contents }]);
      return path;
    } catch (error) {
      if (error instanceof NoteExistsError) continue;
      if (error instanceof WriteFailedError) throw new BrainDumpError(`cannot write the Dump into ${vault.inbox}: ${error.reason}`);
      throw error;
    }
  }
}

function renderDump(origin: Origin, body: string, session: CoveredSession | undefined): string {
  const swept = origin.kind === "dev" && origin.swept ? ["  - dump/swept"] : [];
  const covered = session === undefined ? [] : [`session: ${session.id}`, `through: ${session.through.toISOString()}`];
  const frontmatter = ["---", "tags:", "  - dump", ...swept, "  - AIGenerated", `  - ${origin.tool}`, ...covered, "---"];
  return `${frontmatter.join("\n")}\n${renderOriginLine(origin)}\n\n${body}`;
}
