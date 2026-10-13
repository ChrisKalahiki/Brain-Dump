import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { datePart, pad } from "./clock.ts";
import { parseDumpBody, renderDumpBody, type DumpBody } from "./dump-body.ts";
import { BrainDumpError, DumpNotWrittenError, UsageError } from "./errors.ts";
import { commit, NoteExistsError, WriteFailedError } from "./gateway.ts";
import { isChatTool, TOOL_TAGS, toolName, toolNamed, type Origin } from "./origin.ts";
import type { RunInfo } from "./runs.ts";
import { findSecret } from "./secrets.ts";
import { expandHome, locateVault, type Vault } from "./vault.ts";

// The Dump document: its filename, frontmatter, origin line and body are written and read back here, and nowhere else.

const OBSIDIAN_FORBIDDEN = /[*"\\/<>:|?#^[\]]+/g;
const DUMP_FILENAME = /^(\d{4}-\d{2}-\d{2}) \d{4} (.+?) - (.+)\.md$/;
/** A Session id the frontmatter can hold unquoted: Claude Code's are UUIDs, Codex's thread ids alike. */
const SESSION_ID = /^[\w.-]+$/;
const ORIGIN_PREFIX = "Session: ";
const DISPLAY_STAMP = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

/** The tool's own id for the Session a Dump covers, and the time of the last record it covers. */
export type CoveredSession = { id: string; through: Date };

/** A Dump as written: `swept` when the Sweep drafted it rather than the user's own `dump`; `body` is written as given. */
export type DumpDocument = { origin: Origin; swept: boolean; session: CoveredSession | undefined; slug: string; body: string };

/** What `write-dump` and the Sweep ask for; `through` defaults to the origin's time. */
export type DumpRequest = { origin: Origin; swept?: boolean; slug: string; body: string; session?: string; through?: Date };

/** A Dump checked and rendered, not yet written: `stem` is its filename before any `-2` suffix. */
export type PreparedDump = { stem: string; contents: string };

export type ParsedDump = Omit<DumpDocument, "body"> & {
  date: string;
  /** The filename's segment before the slug: a dev Dump's Project, a chat Dump's tool. */
  label: string;
  body: DumpBody;
  /** Where in `lines` the body starts; the body's own line numbers count from there. */
  bodyStart: number;
  lines: string[];
  eol: string;
};

export type DumpProblem = { problem: string };

export class SecretRefusedError extends BrainDumpError {
  constructor(
    readonly line: number,
    readonly kind: string,
  ) {
    super(`Dump refused: line ${line} looks like it holds ${kind}; remove it and write the Dump again`);
  }
}

export function writeDump(request: DumpRequest): string {
  const { stem, contents } = prepareDump(request);
  try {
    return createWithFreeName(locateVault(), stem, contents);
  } catch (error) {
    if (error instanceof BrainDumpError) throw new DumpNotWrittenError(error.message, contents);
    throw error;
  }
}

/** Refuses a Dump breaking the origin and coverage rules, a body holding a secret or breaking the Dump rules, before anything is written. */
export function prepareDump({ origin, swept = false, slug, body, session, through }: DumpRequest): PreparedDump {
  const stem = dumpStem(origin, slug);
  checkCoverage({ origin, swept, session, through });
  const secret = findSecret(body);
  if (secret !== undefined) throw new SecretRefusedError(secret.line, secret.kind);
  const covered = session === undefined ? undefined : { id: session, through: through ?? origin.at };
  return { stem, contents: renderContents({ origin, swept, session: covered, slug, body: renderDumpBody(parseDumpBody(body)) }) };
}

/** The origin and coverage rules alone, so the Sweep can refuse a Session before paying for its draft. */
export function checkCoverage({ origin, swept = false, session, through }: Omit<DumpRequest, "slug" | "body">): void {
  if (session !== undefined && !SESSION_ID.test(session)) throw new UsageError(`--session "${session}" may hold only letters, digits, ".", "_" and "-"`);
  if (through !== undefined && session === undefined) throw new UsageError("--through needs --session");
  if (swept && origin.kind === "chat") throw new UsageError(`--swept is only for ${TOOL_TAGS.filter((tool) => !isChatTool(tool)).join(" and ")}`);
  if (swept && session === undefined) throw new UsageError("--swept needs --session");
}

/** Renders a Dump as it is, unchecked. */
export function renderDump(document: DumpDocument): PreparedDump {
  return { stem: dumpStem(document.origin, document.slug), contents: renderContents(document) };
}

/** Reads a Dump back from its filename and contents, or names what keeps it from being one. */
export function parseDump(filename: string, contents: string): ParsedDump | DumpProblem {
  const name = basename(filename);
  const file = DUMP_FILENAME.exec(name);
  if (!file?.[1] || !file[2] || !file[3]) return { problem: "not a Dump filename" };
  const eol = contents.includes("\r\n") ? "\r\n" : "\n";
  const lines = contents.split(eol);
  const close = frontmatterEnd(lines);
  if (close === -1) return { problem: "no frontmatter" };
  const covered = readCoverage(lines.slice(1, close));
  if ("problem" in covered) return covered;
  const originLine = lines[close + 1] ?? "";
  if (!originLine.startsWith(ORIGIN_PREFIX)) return { problem: `no ${ORIGIN_PREFIX.trim()} origin line after the frontmatter` };
  const origin = parseOriginLine(originLine);
  if (origin === undefined) return { problem: `unreadable origin line "${originLine}"` };
  const bodyStart = lines.findIndex((line, index) => index > close + 1 && line.startsWith("## "));
  if (bodyStart === -1) return { problem: "invalid Dump body: it has no Items" };
  let body: DumpBody;
  try {
    body = parseDumpBody(lines.slice(bodyStart).join("\n"), { stored: true });
  } catch (error) {
    if (error instanceof BrainDumpError) return { problem: error.message };
    throw error;
  }
  return { ...origin, session: covered.session, slug: file[3], date: file[1], label: file[2], body, bodyStart, lines, eol };
}

/** The Session a Dump covers, from its frontmatter alone, so a Dump whose body was broken by hand still counts as covering it. */
export function coveredSession(contents: string): CoveredSession | undefined {
  const lines = contents.split(/\r?\n/);
  const close = frontmatterEnd(lines);
  if (close === -1) return undefined;
  const covered = readCoverage(lines.slice(1, close));
  return "problem" in covered ? undefined : covered.session;
}

export function renderOriginLine(origin: Origin, swept: boolean): string {
  const segments = [`${ORIGIN_PREFIX}${toolName(origin.tool)}${swept ? " (swept)" : ""}`];
  if (origin.kind === "dev") {
    const branch = origin.branch === undefined ? "" : ` @ \`${origin.branch}\``;
    segments.push(`\`${abbreviateHome(origin.location)}\`${branch}`);
  } else if (origin.chatUrl !== undefined) {
    segments.push(origin.chatUrl);
  }
  segments.push(displayStamp(origin.at));
  if (origin.kind === "dev") segments.push(...(origin.notes ?? []).map((note) => `(${note})`));
  if (origin.project !== undefined) segments.push(`[[${origin.project}]]`);
  return segments.join(" · ");
}

export function isDumpFile(path: string): boolean {
  return DUMP_FILENAME.test(basename(path));
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

export function toFilenameSafe(slug: string): string {
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

function dumpStem(origin: Origin, slug: string): string {
  const label = origin.kind === "dev" ? origin.project : origin.tool;
  return `${datePart(origin.at)} ${pad(origin.at.getHours())}${pad(origin.at.getMinutes())} ${label} - ${toFilenameSafe(slug)}`;
}

function renderContents({ origin, swept, session, body }: DumpDocument): string {
  const sweptTag = swept ? ["  - dump/swept"] : [];
  const covered = session === undefined ? [] : [`session: ${session.id}`, `through: ${session.through.toISOString()}`];
  const frontmatter = ["---", "tags:", "  - dump", ...sweptTag, "  - AIGenerated", `  - ${origin.tool}`, ...covered, "---"];
  return `${frontmatter.join("\n")}\n${renderOriginLine(origin, swept)}\n\n${body}`;
}

function frontmatterEnd(lines: string[]): number {
  return lines[0] === "---" ? lines.indexOf("---", 1) : -1;
}

function readCoverage(frontmatter: string[]): { session: CoveredSession | undefined } | DumpProblem {
  const value = (key: string): string | undefined => frontmatter.find((line) => line.startsWith(`${key}: `))?.slice(key.length + 2).trim();
  const id = value("session");
  const through = value("through");
  if (id === undefined) return through === undefined ? { session: undefined } : { problem: "through: without session: in the frontmatter" };
  const at = new Date(through ?? "");
  if (Number.isNaN(at.getTime())) return { problem: `session: ${id} has no valid through: in the frontmatter` };
  return { session: { id, through: at } };
}

/** The inverse of `renderOriginLine`; `undefined` for a line it would never write. */
function parseOriginLine(line: string): Pick<DumpDocument, "origin" | "swept"> | undefined {
  const segments = line.slice(ORIGIN_PREFIX.length).split(" · ");
  const head = /^(.+?)( \(swept\))?$/.exec(segments.shift() ?? "");
  const tool = toolNamed(head?.[1] ?? "");
  if (tool === undefined) return undefined;
  const swept = head?.[2] !== undefined;
  const project = /^\[\[(.+)\]\]$/.exec(segments.at(-1) ?? "")?.[1];
  if (project !== undefined) segments.pop();
  if (isChatTool(tool)) {
    if (swept || segments.length < 1 || segments.length > 2) return undefined;
    const at = parseStamp(segments.at(-1));
    const chatUrl = segments.length === 2 ? segments[0] : undefined;
    return at === undefined ? undefined : { origin: { kind: "chat", tool, chatUrl, project, at }, swept };
  }
  const place = /^`(.+?)`(?: @ `(.+)`)?$/.exec(segments.shift() ?? "");
  const at = parseStamp(segments.shift());
  const notes = segments.map((segment) => /^\((.+)\)$/.exec(segment)?.[1]);
  if (!place?.[1] || at === undefined || project === undefined || notes.some((note) => note === undefined)) return undefined;
  return { origin: { kind: "dev", tool, project, location: expandHome(place[1]), branch: place[2], at, notes: notes.filter((note) => note !== undefined) }, swept };
}

function displayStamp(at: Date): string {
  return `${datePart(at)} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** A display stamp back to the local time it shows. */
function parseStamp(stamp: string | undefined): Date | undefined {
  const parts = DISPLAY_STAMP.exec(stamp ?? "")?.slice(1).map(Number);
  if (parts === undefined) return undefined;
  const [year = 0, month = 1, day = 1, hours = 0, minutes = 0] = parts;
  return new Date(year, month - 1, day, hours, minutes);
}

function abbreviateHome(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
