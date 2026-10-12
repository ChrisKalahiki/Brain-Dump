import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DRAFTING_MODEL } from "../src/sweep.ts";

// Skill evals run a skill as the user would, in a headless Claude Code run on the pinned model: the repo's own skills and nothing of the user's
// (no user settings, skills, hooks or CLAUDE.md), with a `brain-dump` on PATH that works on a sandbox Vault.

const ROOT = join(import.meta.dir, "..");
const CLI = join(ROOT, "src", "cli.ts");
const AGENT_TIMEOUT_MS = 15 * 60 * 1000;
const FIXTURE_MESSAGE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\] (User|Assistant):$/;

/** A throwaway home: the Vault at its default place, and a git repo, the Session's project, holding the skills under test. */
export type SkillSandbox = { home: string; vault: string; project: string; path: string };

export function makeSkillSandbox(skills: string[], project = "harbor"): SkillSandbox {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "brain-dump-eval-")));
  const vault = join(home, "Documents", "The Vault");
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  const projectDir = join(home, "Projects", project);
  mkdirSync(join(projectDir, ".claude", "skills"), { recursive: true });
  for (const skill of skills) symlinkSync(join(ROOT, "skills", skill), join(projectDir, ".claude", "skills", skill));
  const init = Bun.spawnSync(["git", "init", "--quiet", "--initial-branch", "main"], { cwd: projectDir });
  if (init.exitCode !== 0) throw new Error(`git init failed in ${projectDir}: ${init.stderr.toString().trim()}`);
  // Only the helper sees the sandbox as home; Claude Code keeps the real one, where its login lives.
  const bin = join(home, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "brain-dump"), `#!/bin/sh\nHOME='${home}' exec bun '${CLI}' "$@"\n`);
  chmodSync(join(bin, "brain-dump"), 0o755);
  return { home, vault, project: projectDir, path: `${bin}:${process.env.PATH ?? ""}` };
}

/** Removes the sandbox, and what Claude Code kept for its project (a Session log, auto-memory) in the real `~/.claude/projects`. */
export function removeSkillSandbox({ home, project }: SkillSandbox): void {
  rmSync(home, { recursive: true, force: true });
  rmSync(claudeProjectFolder(project), { recursive: true, force: true });
}

export type ClaudeRun = {
  prompt: string;
  cwd: string;
  /** Built-in tools the run has; `[]` for none. */
  tools: string[];
  /** Permission rules for tools that may run without asking; anything else is denied, since nobody answers a prompt. */
  allowed?: string[];
  /** A Session to continue, from `writeSessionLog`. */
  resume?: string;
  /** Replaces Claude Code's own system prompt, as a chat app's saved instructions would. */
  systemPrompt?: string;
  path?: string;
};

export type ClaudeReply = { ok: true; reply: string } | { ok: false; error: string };

/** One unsaved headless run; `reply` is its final message. */
export async function runClaude(run: ClaudeRun): Promise<ClaudeReply> {
  const command = [
    "claude",
    "-p",
    run.prompt,
    "--output-format",
    "json",
    "--no-session-persistence",
    "--model",
    DRAFTING_MODEL,
    "--setting-sources",
    "project",
    "--strict-mcp-config",
    "--permission-prompts",
    "none",
    "--tools",
    run.tools.join(","),
    ...(run.allowed === undefined ? [] : ["--allowedTools", run.allowed.join(",")]),
    ...(run.resume === undefined ? [] : ["--resume", run.resume, "--fork-session"]),
    ...(run.systemPrompt === undefined ? [] : ["--system-prompt", run.systemPrompt]),
  ];
  try {
    const child = Bun.spawn(command, { cwd: run.cwd, env: { ...process.env, PATH: run.path ?? process.env.PATH }, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: AGENT_TIMEOUT_MS });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    const result = parseResult(stdout);
    if (exitCode === 0 && result !== undefined && !result.is_error) return { ok: true, reply: result.result };
    const said = (result?.result || stderr.trim() || stdout.trim()).split("\n")[0];
    return { ok: false, error: `claude failed (${child.signalCode === null ? `exit ${exitCode}` : "timed out"})${said ? `: ${said}` : ""}` };
  } catch (error) {
    return { ok: false, error: `cannot run claude: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function parseResult(stdout: string): { is_error: boolean; result: string } | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (typeof parsed !== "object" || parsed === null || !("result" in parsed) || typeof parsed.result !== "string") return undefined;
    return { is_error: "is_error" in parsed && parsed.is_error === true, result: parsed.result };
  } catch {
    return undefined;
  }
}

/**
 * Writes a fixture transcript (`[YYYY-MM-DD HH:MM] User:` and `Assistant:` headers, as the Sweep renders one) as a Claude Code Session log
 * for `cwd`, so a run can resume it. The log sits in the real `~/.claude/projects` for as long as the run needs it; `remove` deletes it and anything
 * else Claude Code kept for `cwd`.
 */
export function writeSessionLog(cwd: string, transcript: string): { id: string; remove: () => void } {
  const id = crypto.randomUUID();
  const folder = claudeProjectFolder(cwd);
  mkdirSync(folder, { recursive: true });
  let parentUuid: string | null = null;
  const rows = parseFixtureTranscript(transcript).map(({ role, text, at }, index) => {
    const uuid = crypto.randomUUID();
    const message =
      role === "user"
        ? { role, content: text }
        : { id: `msg_fixture_${index}`, type: "message", role, model: DRAFTING_MODEL, content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null };
    const row = { parentUuid, isSidechain: false, userType: "external", cwd, sessionId: id, gitBranch: "main", type: role, message, uuid, timestamp: at.toISOString() };
    parentUuid = uuid;
    return JSON.stringify(row);
  });
  writeFileSync(join(folder, `${id}.jsonl`), `${rows.join("\n")}\n`);
  return { id, remove: () => rmSync(folder, { recursive: true, force: true }) };
}

function claudeProjectFolder(cwd: string): string {
  return join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
}

export type FixtureMessage = { role: "user" | "assistant"; text: string; at: Date };

export function parseFixtureTranscript(transcript: string): FixtureMessage[] {
  const messages: FixtureMessage[] = [];
  for (const line of transcript.split("\n")) {
    const header = FIXTURE_MESSAGE.exec(line);
    const last = messages.at(-1);
    if (header?.[1] && header[2]) messages.push({ role: header[2] === "User" ? "user" : "assistant", text: "", at: new Date(`${header[1].replace(" ", "T")}:00Z`) });
    else if (last !== undefined) last.text += `${line}\n`;
  }
  return messages.map((message) => ({ ...message, text: message.text.trim() }));
}
