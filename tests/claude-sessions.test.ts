import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeProjectFolder, readClaudeSession, renderClaudeSession, type ClaudeSessionLog } from "../src/claude-sessions.ts";
import type { SessionMessage } from "../src/transcript.ts";

const MESSAGES: SessionMessage[] = [
  { role: "user", text: "Question 1", at: new Date("2026-10-11T15:00:00Z") },
  { role: "assistant", text: "Answer 1\n\nwith a second paragraph", at: new Date("2026-10-11T15:01:00Z") },
  { role: "user", text: "Question 2", at: new Date("2026-10-11T15:02:00Z") },
];

function readBack(log: ClaudeSessionLog) {
  const file = join(mkdtempSync(join(tmpdir(), "brain-dump-test-")), `${log.session}.jsonl`);
  writeFileSync(file, renderClaudeSession(log));
  const { session, cwd, branch, messages, startsAfterCompaction, lastRecord } = readClaudeSession(file);
  return { session, cwd, branch, messages, startsAfterCompaction, lastRecord };
}

describe("the Claude Code Session log adapter", () => {
  const variants: [string, ClaudeSessionLog][] = [
    ["on a branch", { session: "s-1", cwd: "/Users/me/Projects/Brain-Dump", branch: "main", messages: MESSAGES }],
    ["outside git", { session: "s-2", cwd: "/Users/me/Notes", messages: MESSAGES }],
    ["starting after a compaction", { session: "s-3", cwd: "/Users/me/Projects/Brain-Dump", branch: "main", messages: MESSAGES, startsAfterCompaction: true }],
  ];

  for (const [name, log] of variants) {
    test(`reads back the log it writes for a Session ${name}`, () => {
      // #when
      const read = readBack(log);

      // #then
      expect(read).toEqual({ branch: undefined, startsAfterCompaction: false, ...log, lastRecord: new Date("2026-10-11T15:02:00Z") });
    });
  }

  test("places a project's logs in a folder named for its cwd, every character but letters and digits made a dash", () => {
    // #when
    const folder = claudeProjectFolder("/Users/me/Projects/brain_dump.v2", "/config");

    // #then
    expect(folder).toBe("/config/projects/-Users-me-Projects-brain-dump-v2");
  });
});
