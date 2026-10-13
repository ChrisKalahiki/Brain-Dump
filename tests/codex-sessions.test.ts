import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { codexRolloutPath, readCodexSession, renderCodexSession, type CodexSessionLog } from "../src/codex-sessions.ts";
import type { SessionMessage } from "../src/transcript.ts";

const THREAD = "01a13167-81a4-7843-abad-34ec9c7270cf";
const START = new Date("2026-10-11T15:00:00Z");
const MESSAGES: SessionMessage[] = [
  { role: "user", text: "Question 1", at: START },
  { role: "assistant", text: "Answer 1\n\nwith a second paragraph", at: new Date("2026-10-11T15:01:00Z") },
];

function writeLog(log: CodexSessionLog): string {
  const file = codexRolloutPath(log, mkdtempSync(join(tmpdir(), "brain-dump-test-")));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, renderCodexSession(log));
  return file;
}

describe("the Codex Session log adapter", () => {
  test("reads back the rollout it writes, in the current format", () => {
    // #given
    const log: CodexSessionLog = { thread: THREAD, cwd: "/Users/me/Projects/Brain-Dump", branch: "feature-x", start: START, messages: MESSAGES };
    const file = writeLog(log);

    // #when
    const read = readCodexSession(file);

    // #then
    expect({ session: read?.session, cwd: read?.cwd, branch: read?.branch, messages: read?.messages, lastRecord: read?.lastRecord }).toEqual({
      session: THREAD,
      cwd: log.cwd,
      branch: "feature-x",
      messages: MESSAGES,
      lastRecord: new Date("2026-10-11T15:01:00Z"),
    });
  });

  test("reads back a rollout written outside git with no branch", () => {
    // #given
    const file = writeLog({ thread: THREAD, cwd: "/Users/me/Notes", start: START, messages: MESSAGES });

    // #when
    const read = readCodexSession(file);

    // #then
    expect({ cwd: read?.cwd, branch: read?.branch }).toEqual({ cwd: "/Users/me/Notes", branch: undefined });
  });

  test("reads a rollout it writes for a sub-agent Session as one the Sweep never drafts", () => {
    // #given
    const file = writeLog({ thread: THREAD, cwd: "/Users/me/Projects/Brain-Dump", start: START, messages: MESSAGES, parent: "01a0a813-bc00-7000-8000-000000000000" });

    // #when
    const read = readCodexSession(file);

    // #then
    expect(read).toBeUndefined();
  });

  test("names a rollout by its local start and thread, in a folder per local day", () => {
    // #given
    const log: CodexSessionLog = { thread: THREAD, cwd: "/", start: START, messages: [] };

    // #when
    const path = codexRolloutPath(log, "/codex");

    // #then
    expect(path).toBe(`/codex/sessions/2026/10/11/rollout-2026-10-11T15-00-00-${THREAD}.jsonl`);
  });

  test("still reads a rollout in the format before Codex 0.147, from its message events alone", () => {
    // #given
    const file = join(import.meta.dir, "fixtures", "codex-rollout-pre-0.147.jsonl");

    // #when
    const read = readCodexSession(file);

    // #then
    expect({ session: read?.session, cwd: read?.cwd, branch: read?.branch, messages: read?.messages }).toEqual({
      session: "0199a0f2-4c1e-7d30-9a51-2f6b8c3d1e70",
      cwd: "/Users/me/Projects/Brain-Dump",
      branch: "feature-x",
      messages: [
        { role: "user", text: "Question 1", at: new Date("2026-09-01T15:00:00Z") },
        { role: "assistant", text: "Answer 1", at: new Date("2026-09-01T15:01:00Z") },
        { role: "user", text: "Question 2", at: new Date("2026-09-01T15:02:00Z") },
        { role: "assistant", text: "Answer 2", at: new Date("2026-09-01T15:03:00Z") },
      ],
    });
  });
});
