import { homedir } from "node:os";
import { basename } from "node:path";

const TOOL_NAMES = {
  ClaudeCode: "Claude Code",
  Codex: "Codex",
} as const;

export type ToolTag = keyof typeof TOOL_NAMES;

export const TOOL_TAGS = Object.keys(TOOL_NAMES) as ToolTag[];

export function isToolTag(value: string): value is ToolTag {
  return Object.hasOwn(TOOL_NAMES, value);
}

export type Origin = {
  tool: ToolTag;
  project: string;
  location: string;
  branch: string | undefined;
  at: Date;
};

export function detectOrigin(tool: ToolTag, cwd: string, at: Date): Origin {
  const root = git(cwd, "rev-parse", "--show-toplevel") ?? cwd;
  const branch = git(cwd, "branch", "--show-current") || undefined;
  return { tool, project: basename(root), location: root, branch, at };
}

export function renderOriginLine(origin: Origin): string {
  const location = `\`${abbreviateHome(origin.location)}\``;
  const branch = origin.branch === undefined ? "" : ` @ \`${origin.branch}\``;
  return `Session: ${TOOL_NAMES[origin.tool]} · ${location}${branch} · ${displayStamp(origin.at)} · [[${origin.project}]]`;
}

export function filenameStamp(at: Date): string {
  return `${datePart(at)} ${pad(at.getHours())}${pad(at.getMinutes())}`;
}

function displayStamp(at: Date): string {
  return `${datePart(at)} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function datePart(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function abbreviateHome(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

function git(cwd: string, ...args: string[]): string | undefined {
  const result = Bun.spawnSync(["git", ...args], { cwd, stderr: "ignore" });
  return result.exitCode === 0 ? result.stdout.toString().trim() : undefined;
}
