#!/usr/bin/env bun
import { parseArgs, type ParseArgsConfig } from "node:util";
import { writeDump } from "./dump.ts";
import { BrainDumpError, DumpNotWrittenError, UsageError } from "./errors.ts";
import { detectOrigin, isToolTag, TOOL_TAGS } from "./origin.ts";
import { locateVault } from "./vault.ts";

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "vault":
      process.stdout.write(`${locateVault().root}\n`);
      return 0;
    case "write-dump":
      process.stdout.write(`${await runWriteDump(rest)}\n`);
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
  });
  if (values.tool === undefined || !isToolTag(values.tool)) {
    throw new UsageError(`--tool must be one of ${TOOL_TAGS.join(", ")}`);
  }
  if (values.slug === undefined) throw new UsageError("--slug is required");
  const at = values.at === undefined ? new Date() : new Date(values.at);
  if (Number.isNaN(at.getTime())) throw new UsageError(`--at "${values.at}" is not a date and time`);
  const origin = detectOrigin(values.tool, process.cwd(), at);
  return writeDump(origin, values.slug, await Bun.stdin.text());
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
