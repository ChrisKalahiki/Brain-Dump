import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { expandHome, resolveVaultPath } from "./vault.ts";

// The Vault guard, a Claude Code PreToolUse hook (issue #34). Exit 2 denies with the reason on stderr; anything else lets the call through.
// It catches agents drifting off brain-dump, not determined evasion: the write gateway and undo are the safety net.

const FILE_TOOLS = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit", "Read", "Grep", "Glob"]);
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);

export type Verdict = { allow: true } | { allow: false; reason: string };

const ALLOW: Verdict = { allow: true };

type HookInput = { tool: string; input: Record<string, unknown>; cwd: string };

/** Stands down when `projectDir` (`CLAUDE_PROJECT_DIR`) is inside the Vault: the user's own editing. On an internal error, denies only a call that plausibly touches the Vault. */
export function guard(hookInput: string, projectDir: string | undefined): Verdict {
  try {
    return decide(hookInput, projectDir);
  } catch (error) {
    if (!/vault/i.test(hookInput)) return ALLOW;
    const tool = /"tool_name"\s*:\s*"([^"]*)"/.exec(hookInput)?.[1] ?? "unknown tool";
    return deny(tool, `Vault mention in hook input (guard error: ${error instanceof Error ? error.message : String(error)})`);
  }
}

function decide(hookInput: string, projectDir: string | undefined): Verdict {
  const { tool, input, cwd } = parseHookInput(hookInput);
  const configured = resolveVaultPath();
  const root = canonical(configured);
  if (projectDir !== undefined && projectDir !== "" && isInside(canonical(projectDir), root)) return ALLOW;
  if (FILE_TOOLS.has(tool)) {
    const target = [...filePaths(input, cwd), ...globBase(tool, input)].find((path) => isInside(canonical(path), root));
    return target === undefined ? ALLOW : deny(tool, target);
  }
  if (SHELL_TOOLS.has(tool)) {
    const command = typeof input.command === "string" ? input.command : "";
    const fromVault = isInside(canonical(cwd), root);
    if (!fromVault && !namesVault(command, [configured, root])) return ALLOW;
    return isSingleBrainDumpCall(command) ? ALLOW : deny(tool, fromVault ? cwd : "Vault mention in command");
  }
  return ALLOW;
}

function deny(tool: string, target: string): Verdict {
  return { allow: false, reason: `Vault access goes through brain-dump only (recall, show, write-dump, file). Blocked: ${tool} on ${target}.` };
}

function parseHookInput(text: string): HookInput {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed) || typeof parsed.tool_name !== "string") throw new Error("hook input has no tool_name");
  const input = isRecord(parsed.tool_input) ? parsed.tool_input : {};
  const cwd = typeof parsed.cwd === "string" ? parsed.cwd : process.cwd();
  return { tool: parsed.tool_name, input, cwd };
}

/** The paths a file tool names, or `cwd` when it names none. */
function filePaths(input: Record<string, unknown>, cwd: string): string[] {
  const named = [input.file_path, input.notebook_path, input.path].filter((value): value is string => typeof value === "string" && value !== "");
  return (named.length > 0 ? named : [cwd]).map((path) => resolve(cwd, expandHome(path)));
}

/** An absolute Glob pattern names its folder too: the segments before the first wildcard. */
function globBase(tool: string, input: Record<string, unknown>): string[] {
  const pattern = typeof input.pattern === "string" ? expandHome(input.pattern) : "";
  if (tool !== "Glob" || !isAbsolute(pattern)) return [];
  const segments = pattern.split(sep);
  const wildcard = segments.findIndex((segment) => /[*?[{]/.test(segment));
  return [resolve(segments.slice(0, wildcard === -1 ? undefined : wildcard).join(sep) || sep)];
}

/** Whether `command` names the Vault folder in any common spelling: `The Vault`, `The\\ Vault`, `"The Vault"`, `The?Vault`, in any case. */
function namesVault(command: string, roots: string[]): boolean {
  return roots.some((root) => {
    const words = basename(root).split(/\s+/).filter(Boolean).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (words.length === 0) return false;
    const spelled = words.join(String.raw`(?:[\s\\?*'"]|%20)+`);
    return new RegExp(String.raw`(?<![\p{L}\p{N}_-])${spelled}(?![\p{L}\p{N}_-])`, "iu").test(command);
  });
}

type Heredoc = { delimiter: string; stripTabs: boolean };

/** A single `brain-dump …` invocation: at most one quoted heredoc, and no separators, pipes, substitutions or redirects outside it. */
function isSingleBrainDumpCall(command: string): boolean {
  const text = command.trim();
  if (!/^brain-dump(?=\s|$)/.test(text)) return false;
  const line = scanCommandLine(text);
  if (line === undefined) return false;
  if (line.heredoc === undefined) return true;
  return endsOnlyWithHeredoc(text.slice(line.end), line.heredoc);
}

/** Scans the first line of `text` outside quotes; `undefined` when anything there could run a second command, or when a newline comes with no heredoc to feed. */
function scanCommandLine(text: string): { end: number; heredoc?: Heredoc } | undefined {
  let quote: "'" | '"' | undefined;
  let heredoc: Heredoc | undefined;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote === "'") {
      if (char === "'") quote = undefined;
      continue;
    }
    if (char === "\\") {
      i++;
      continue;
    }
    if (char === "`" || (char === "$" && text[i + 1] === "(")) return undefined;
    if (quote === '"') {
      if (char === '"') quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "\n") return heredoc && { end: i + 1, heredoc };
    if (char === "<") {
      const match = /^<<(-?)[ \t]*(['"])([^'"\n]+)\2(?=\s|$)/.exec(text.slice(i));
      if (match === null || heredoc !== undefined) return undefined;
      heredoc = { stripTabs: match[1] === "-", delimiter: match[3] ?? "" };
      i += match[0].length - 1;
      continue;
    }
    if (";&|>".includes(char ?? "")) return undefined;
  }
  return quote === undefined && heredoc === undefined ? { end: text.length } : undefined;
}

/** Whether the heredoc body closes on its own delimiter line with nothing after it. */
function endsOnlyWithHeredoc(body: string, { delimiter, stripTabs }: Heredoc): boolean {
  const lines = body.split("\n");
  const end = lines.findIndex((line) => (stripTabs ? line.replace(/^\t+/, "") : line) === delimiter);
  return end !== -1 && lines.slice(end + 1).join("").trim() === "";
}

/** The realpath of `path`, or of its nearest existing parent with the missing segments appended. */
function canonical(path: string): string {
  const missing: string[] = [];
  let existing = path;
  while (!existsSync(existing) && dirname(existing) !== existing) {
    missing.unshift(basename(existing));
    existing = dirname(existing);
  }
  return join(realpathSync.native(existing), ...missing);
}

function isInside(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
