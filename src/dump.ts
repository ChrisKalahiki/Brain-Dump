import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { parseDumpBody, renderDumpBody } from "./dump-body.ts";
import { BrainDumpError, DumpNotWrittenError, UsageError } from "./errors.ts";
import { commit, NoteExistsError, WriteFailedError } from "./gateway.ts";
import { dumpStem, renderOriginLine, type Origin } from "./origin.ts";
import type { RunInfo } from "./runs.ts";
import { findSecret } from "./secrets.ts";
import { locateVault, type Vault } from "./vault.ts";

const OBSIDIAN_FORBIDDEN = /[*"\\/<>:|?#^[\]]+/g;

/** The tool's own id for the Session a Dump covers, and the time of the last record it covers. */
export type CoveredSession = { id: string; through: Date };

/** A Dump checked and rendered, not yet written: `stem` is its filename before any `-2` suffix. */
export type PreparedDump = { stem: string; contents: string };

export class SecretRefusedError extends BrainDumpError {
  constructor(
    readonly line: number,
    readonly kind: string,
  ) {
    super(`Dump refused: line ${line} looks like it holds ${kind}; remove it and write the Dump again`);
  }
}

export function writeDump(origin: Origin, slug: string, body: string, session?: CoveredSession): string {
  const { stem, contents } = prepareDump(origin, slug, body, session);
  try {
    return createWithFreeName(locateVault(), stem, contents);
  } catch (error) {
    if (error instanceof BrainDumpError) throw new DumpNotWrittenError(error.message, contents);
    throw error;
  }
}

/** Refuses a body holding a secret or breaking the Dump rules, before anything is written. */
export function prepareDump(origin: Origin, slug: string, body: string, session?: CoveredSession): PreparedDump {
  const stem = `${dumpStem(origin)} - ${toFilenameSafe(slug)}`;
  const secret = findSecret(body);
  if (secret !== undefined) throw new SecretRefusedError(secret.line, secret.kind);
  return { stem, contents: renderDump(origin, renderDumpBody(parseDumpBody(body)), session) };
}

/** Creates every Dump in the Inbox as one Run, each under a free name. Returns the Run's id and the Dumps' paths. */
export function writeDumps(vault: Vault, run: RunInfo, dumps: PreparedDump[]): { run: string; paths: string[] } {
  const taken = new Set<string>();
  const paths = dumps.map(({ stem }) => {
    const path = freeNames(vault, stem).find((candidate) => !taken.has(candidate) && !existsSync(candidate)) ?? "";
    taken.add(path);
    return path;
  });
  const id = commit(
    vault,
    "automation",
    run,
    dumps.map(({ contents }, index) => ({ mode: "create", path: paths[index] ?? "", contents })),
  );
  return { run: id, paths };
}

function toFilenameSafe(slug: string): string {
  const safe = slug.replace(OBSIDIAN_FORBIDDEN, " ").replace(/\s+/g, " ").trim();
  if (safe === "") throw new UsageError(`--slug "${slug}" has no usable characters`);
  return safe;
}

/** `stem.md`, then `stem-2.md`, `stem-3.md` and so on. */
function* freeNames(vault: Vault, stem: string): Generator<string> {
  for (let copy = 1; ; copy++) yield join(vault.inbox, `${stem}${copy === 1 ? "" : `-${copy}`}.md`);
}

function createWithFreeName(vault: Vault, stem: string, contents: string): string {
  for (const path of freeNames(vault, stem)) {
    try {
      commit(vault, "automation", { command: "write-dump", label: basename(path, ".md") }, [{ mode: "create", path, contents }]);
      return path;
    } catch (error) {
      if (error instanceof NoteExistsError) continue;
      if (error instanceof WriteFailedError) throw new BrainDumpError(`cannot write the Dump into ${vault.inbox}: ${error.reason}`);
      throw error;
    }
  }
  throw new Error("unreachable: freeNames never ends");
}

function renderDump(origin: Origin, body: string, session: CoveredSession | undefined): string {
  const swept = origin.kind === "dev" && origin.swept ? ["  - dump/swept"] : [];
  const covered = session === undefined ? [] : [`session: ${session.id}`, `through: ${session.through.toISOString()}`];
  const frontmatter = ["---", "tags:", "  - dump", ...swept, "  - AIGenerated", `  - ${origin.tool}`, ...covered, "---"];
  return `${frontmatter.join("\n")}\n${renderOriginLine(origin)}\n\n${body}`;
}
