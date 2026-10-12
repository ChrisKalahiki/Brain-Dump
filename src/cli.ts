#!/usr/bin/env bun
import { parseArgs, type ParseArgsConfig } from "node:util";
import { checkVault, renderFinding, type Finding } from "./check.ts";
import { now } from "./clock.ts";
import { consolidate, parseConsolidationPlan } from "./consolidate.ts";
import { writeDump } from "./dump.ts";
import { listDumps } from "./duplicates.ts";
import { BrainDumpError, describeFsError, DumpNotWrittenError, errnoCode, UsageError } from "./errors.ts";
import { detectDevOrigin, isChatTool, isToolTag, projectOf, TOOL_TAGS, type Origin } from "./origin.ts";
import { applyFilingPlan, parseFilingPlan } from "./filing.ts";
import { guard } from "./guard.ts";
import { listUnfiledDumps } from "./inbox.ts";
import { listNotes } from "./notes.ts";
import { pointerLines } from "./pointer.ts";
import { parseRecallQuery, recall } from "./recall.ts";
import { readRoutesNote } from "./routes.ts";
import { listRuns } from "./runs.ts";
import { showNote } from "./show.ts";
import { readTodoGroups } from "./todo-groups.ts";
import { findVault, locateVault } from "./vault.ts";
import { undoRun } from "./undo.ts";
import { findWeeklyNote } from "./weekly.ts";

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "vault":
      process.stdout.write(`${locateVault().root}\n`);
      return 0;
    case "write-dump":
      process.stdout.write(`${await runWriteDump(rest)}\n`);
      return 0;
    case "list-dumps": {
      const vault = locateVault();
      writeJson(listDumps(vault, listUnfiledDumps(vault)));
      return 0;
    }
    case "list-notes":
      writeJson(listNotes(locateVault()));
      return 0;
    case "recall":
      writeJson(recall(locateVault(), parseRecallQuery(rest, () => projectOf(process.cwd()))));
      return 0;
    case "show": {
      const notes = rest.filter((arg) => arg !== "--full");
      if (notes.length !== 1 || notes[0]?.startsWith("--")) throw new UsageError("show takes one note and optionally --full");
      writeJson(showNote(locateVault(), notes[0] ?? "", { full: rest.includes("--full") }));
      return 0;
    }
    case "routes":
      writeJson(readRoutesNote(locateVault()));
      return 0;
    case "weekly-note": {
      const { date } = parseOptions(rest, { date: { type: "string" } });
      if (date === undefined) throw new UsageError("--date is required");
      writeJson(findWeeklyNote(locateVault(), date));
      return 0;
    }
    case "todo-groups": {
      const { date } = parseOptions(rest, { date: { type: "string" } });
      if (date === undefined) throw new UsageError("--date is required");
      writeJson(readTodoGroups(locateVault(), date));
      return 0;
    }
    case "apply":
      writeJson(applyFilingPlan(locateVault(), parseFilingPlan(await Bun.stdin.text())));
      return 0;
    case "guard": {
      const verdict = guard(await Bun.stdin.text(), process.env.CLAUDE_PROJECT_DIR);
      if (verdict.allow) return 0;
      process.stderr.write(`${verdict.reason}\n`);
      return 2;
    }
    case "check":
      return runCheck(rest);
    case "pointer": {
      const lines = pointerLines(projectOf(process.cwd()));
      if (lines.length > 0) process.stdout.write(`${lines.join("\n")}\n`);
      return 0;
    }
    case "consolidate": {
      const [note, ...flags] = rest;
      if (note === undefined || note.startsWith("-")) throw new UsageError("consolidate needs a note");
      const { confirm } = parseOptions(flags, { confirm: { type: "boolean" } });
      writeJson(consolidate(locateVault(), note, parseConsolidationPlan(await Bun.stdin.text()), { confirm }));
      return 0;
    }
    case "runs":
      writeJson(listRuns());
      return 0;
    case "undo": {
      const [id, ...flags] = rest;
      if (id === undefined || id.startsWith("-")) throw new UsageError("undo needs a run id");
      const { confirm } = parseOptions(flags, { confirm: { type: "boolean" } });
      writeJson(undoRun(locateVault(), id, { confirm }));
      return 0;
    }
    default:
      throw new UsageError(`unknown command ${command ?? "(none)"}`);
  }
}

/** A Session id the frontmatter can hold unquoted: Claude Code's are UUIDs, Codex's thread ids alike. */
const SESSION_ID = /^[\w.-]+$/;

async function runWriteDump(args: string[]): Promise<string> {
  const values = parseOptions(args, {
    tool: { type: "string" },
    slug: { type: "string" },
    at: { type: "string" },
    "chat-url": { type: "string" },
    project: { type: "string" },
    session: { type: "string" },
    through: { type: "string" },
    swept: { type: "boolean" },
  });
  if (values.tool === undefined || !isToolTag(values.tool)) {
    throw new UsageError(`--tool must be one of ${TOOL_TAGS.join(", ")}`);
  }
  if (values.slug === undefined) throw new UsageError("--slug is required");
  const at = values.at === undefined ? now() : new Date(values.at);
  if (Number.isNaN(at.getTime())) throw new UsageError(`--at "${values.at}" is not a date and time`);
  const hasChatOptions = values["chat-url"] !== undefined || values.project !== undefined;
  if (hasChatOptions && !isChatTool(values.tool)) {
    throw new UsageError(`--chat-url and --project are only for chat tools (${TOOL_TAGS.filter(isChatTool).join(", ")})`);
  }
  const session = values.session || undefined;
  if (session !== undefined && !SESSION_ID.test(session)) throw new UsageError(`--session "${session}" may hold only letters, digits, ".", "_" and "-"`);
  if (values.through !== undefined && session === undefined) throw new UsageError("--through needs --session");
  const through = values.through === undefined ? at : new Date(values.through);
  if (Number.isNaN(through.getTime())) throw new UsageError(`--through "${values.through}" is not a date and time`);
  if (values.swept && isChatTool(values.tool)) throw new UsageError(`--swept is only for ${TOOL_TAGS.filter((tool) => !isChatTool(tool)).join(" and ")}`);
  if (values.swept && session === undefined) throw new UsageError("--swept needs --session");
  const origin: Origin = isChatTool(values.tool)
    ? { kind: "chat", tool: values.tool, chatUrl: values["chat-url"], project: values.project, at }
    : { ...detectDevOrigin(values.tool, process.cwd(), at), swept: values.swept };
  return writeDump(origin, values.slug, await Bun.stdin.text(), session === undefined ? undefined : { id: session, through });
}

/** Exit 1 means findings, so a Vault that can't be checked exits 2. */
function runCheck(args: string[]): number {
  const { json } = parseOptions(args, { json: { type: "boolean" } });
  let findings: Finding[];
  try {
    findings = checkVault(findVault());
  } catch (error) {
    const reason = error instanceof BrainDumpError ? error.message : unreadable(error);
    if (reason === undefined) throw error;
    process.stderr.write(`brain-dump: ${reason}\n`);
    return 2;
  }
  if (json) writeJson(findings);
  else process.stdout.write(findings.length === 0 ? "No Vault findings.\n" : `${findings.map(renderFinding).join("\n")}\n`);
  return findings.length === 0 ? 0 : 1;
}

function unreadable(error: unknown): string | undefined {
  if (errnoCode(error) === undefined) return undefined;
  const path = error instanceof Error && "path" in error && typeof error.path === "string" ? ` ${error.path}` : "";
  return `cannot read${path}: ${describeFsError(error)}`;
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function parseOptions<T extends ParseArgsConfig["options"]>(args: string[], options: T) {
  try {
    return parseArgs({ args, options, strict: true }).values;
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

// exitCode, not process.exit(): exiting immediately truncates stdout when it is a pipe.
try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof BrainDumpError)) throw error;
  if (error instanceof DumpNotWrittenError) process.stdout.write(error.dump);
  process.stderr.write(`brain-dump: ${error.message}\n`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
}
