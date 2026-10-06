import { homedir } from "node:os";
import { basename } from "node:path";

const TOOL_NAMES = {
  ClaudeCode: "Claude Code",
  Codex: "Codex",
} as const;

export type ToolTag = keyof typeof TOOL_NAMES;

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
  return `Session: ${TOOL_NAMES[origin.tool]} · ${location}${branch} · ${formatDateTime(origin.at, ":")} · [[${origin.project}]]`;
}

export function formatDateTime(at: Date, timeSeparator: string): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return `${date} ${pad(at.getHours())}${timeSeparator}${pad(at.getMinutes())}`;
}

function abbreviateHome(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

function git(cwd: string, ...args: string[]): string | undefined {
  const result = Bun.spawnSync(["git", ...args], { cwd, stderr: "ignore" });
  return result.exitCode === 0 ? result.stdout.toString().trim() : undefined;
}
