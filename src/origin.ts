import { basename, dirname } from "node:path";

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

/** The tool's name as people know it, e.g. "Claude Code". */
export function toolName(tool: ToolTag): string {
  return TOOLS[tool].name;
}

export function toolNamed(name: string): ToolTag | undefined {
  return TOOL_TAGS.find((tool) => TOOLS[tool].name === name);
}

export type DevOrigin = {
  kind: "dev";
  tool: DevToolTag;
  project: string;
  location: string;
  branch: string | undefined;
  at: Date;
  /** What the origin line should warn about the draft, e.g. "truncated". */
  notes?: string[];
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
  return { kind: "dev", tool, project: projectOf(cwd), location: root, branch, at };
}

/** The main worktree's folder name, so linked worktrees don't split a project; outside a repo, the directory's own name. */
export function projectOf(cwd: string): string {
  const commonDir = git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir");
  if (commonDir !== undefined && basename(commonDir) === ".git") return basename(dirname(commonDir));
  return basename(git(cwd, "rev-parse", "--show-toplevel") ?? cwd);
}

function git(cwd: string, ...args: string[]): string | undefined {
  const result = Bun.spawnSync(["git", ...args], { cwd, stderr: "ignore" });
  return result.exitCode === 0 ? result.stdout.toString().trim() : undefined;
}
