import { homedir } from "node:os";
import { basename } from "node:path";

const TOOLS = {
  ClaudeCode: { name: "Claude Code", kind: "dev" },
  Codex: { name: "Codex", kind: "dev" },
  ClaudeWeb: { name: "Claude web", kind: "chat" },
  ChatGPT: { name: "ChatGPT", kind: "chat" },
  Gemini: { name: "Gemini", kind: "chat" },
} as const;

export type ToolTag = keyof typeof TOOLS;

export type ChatToolTag = { [T in ToolTag]: (typeof TOOLS)[T]["kind"] extends "chat" ? T : never }[ToolTag];

export type DevToolTag = Exclude<ToolTag, ChatToolTag>;

export const TOOL_TAGS = Object.keys(TOOLS) as ToolTag[];

export function isToolTag(value: string): value is ToolTag {
  return Object.hasOwn(TOOLS, value);
}

export function isChatTool(tool: ToolTag): tool is ChatToolTag {
  return TOOLS[tool].kind === "chat";
}

export type DevOrigin = {
  kind: "dev";
  tool: DevToolTag;
  project: string;
  location: string;
  branch: string | undefined;
  at: Date;
};

export type ChatOrigin = {
  kind: "chat";
  tool: ChatToolTag;
  chatUrl: string | undefined;
  project: string | undefined;
  at: Date;
};

export type Origin = DevOrigin | ChatOrigin;

export function detectDevOrigin(tool: DevToolTag, cwd: string, at: Date): DevOrigin {
  const root = git(cwd, "rev-parse", "--show-toplevel") ?? cwd;
  const branch = git(cwd, "branch", "--show-current") || undefined;
  return { kind: "dev", tool, project: basename(root), location: root, branch, at };
}

export function dumpStem(origin: Origin): string {
  const label = origin.kind === "dev" ? origin.project : origin.tool;
  return `${filenameStamp(origin.at)} ${label}`;
}

export function renderOriginLine(origin: Origin): string {
  const segments = [`Session: ${TOOLS[origin.tool].name}`];
  if (origin.kind === "dev") {
    const branch = origin.branch === undefined ? "" : ` @ \`${origin.branch}\``;
    segments.push(`\`${abbreviateHome(origin.location)}\`${branch}`);
  } else if (origin.chatUrl !== undefined) {
    segments.push(origin.chatUrl);
  }
  segments.push(displayStamp(origin.at));
  if (origin.project !== undefined) segments.push(`[[${origin.project}]]`);
  return segments.join(" · ");
}

function filenameStamp(at: Date): string {
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
