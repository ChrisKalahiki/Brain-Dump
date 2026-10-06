#!/usr/bin/env bun
import { parseArgs, type ParseArgsConfig } from "node:util";
import { writeDump } from "./dump.ts";
import { BrainDumpError, DumpNotWrittenError, UsageError } from "./errors.ts";
import { detectDevOrigin, isChatTool, isToolTag, TOOL_TAGS, type Origin } from "./origin.ts";
import { applyFilingPlan, parseFilingPlan } from "./filing.ts";
import { listUnfiledDumps, summarize } from "./inbox.ts";
import { locateVault } from "./vault.ts";
import { findWeekNote } from "./weekly.ts";

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "vault":
      process.stdout.write(`${locateVault().root}\n`);
      return 0;
    case "write-dump":
      process.stdout.write(`${await runWriteDump(rest)}\n`);
      return 0;
    case "list-dumps":
      writeJson(listUnfiledDumps(locateVault()).map(summarize));
      return 0;
    case "week-note": {
      const { date } = parseOptions(rest, { date: { type: "string" } });
      if (date === undefined) throw new UsageError("--date is required");
      writeJson(findWeekNote(locateVault(), date));
      return 0;
    }
    case "apply":
      writeJson(applyFilingPlan(locateVault(), parseFilingPlan(await Bun.stdin.text())));
      return 0;
    default:
      throw new UsageError(`unknown command ${command ?? "(none)"}`);
  }
}

async function runWriteDump(args: string[]): Promise<string> {
  const values = parseOptions(args, {
    tool: { type: "string" },
    slug: { type: "string" },
    at: { type: "string" },
    "chat-url": { type: "string" },
    project: { type: "string" },
  });
  if (values.tool === undefined || !isToolTag(values.tool)) {
    throw new UsageError(`--tool must be one of ${TOOL_TAGS.join(", ")}`);
  }
  if (values.slug === undefined) throw new UsageError("--slug is required");
  const at = values.at === undefined ? new Date() : new Date(values.at);
  if (Number.isNaN(at.getTime())) throw new UsageError(`--at "${values.at}" is not a date and time`);
  const hasChatOptions = values["chat-url"] !== undefined || values.project !== undefined;
  if (hasChatOptions && !isChatTool(values.tool)) {
    throw new UsageError(`--chat-url and --project are only for chat tools (${TOOL_TAGS.filter(isChatTool).join(", ")})`);
  }
  const origin: Origin = isChatTool(values.tool)
    ? { kind: "chat", tool: values.tool, chatUrl: values["chat-url"], project: values.project, at }
    : detectDevOrigin(values.tool, process.cwd(), at);
  return writeDump(origin, values.slug, await Bun.stdin.text());
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

try {
  process.exit(await main(process.argv.slice(2)));
} catch (error) {
  if (!(error instanceof BrainDumpError)) throw error;
  if (error instanceof DumpNotWrittenError) process.stdout.write(error.dump);
  process.stderr.write(`brain-dump: ${error.message}\n`);
  process.exit(error instanceof UsageError ? 2 : 1);
}
