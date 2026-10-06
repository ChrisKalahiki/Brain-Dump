import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DUMP_AT, makeSandbox, run } from "./harness.ts";

const BODY = `## Learnings
- [ ] Claude web share links return an empty shell (https://claude.ai/share/abc).
`;

describe("brain-dump write-dump for a chat Session", () => {
  test("writes a chat Dump named after the tool, with the chat URL and named project", () => {
    // #given
    const sandbox = makeSandbox();
    const args = ["write-dump", "--tool", "ClaudeWeb", "--slug", "share links", "--at", DUMP_AT];
    args.push("--chat-url", "https://claude.ai/chat/123", "--project", "Brain-Dump");

    // #when
    const result = run(sandbox, args, { stdin: BODY });

    // #then
    const path = join(sandbox.vault, "Inbox", "2026-10-05 1940 ClaudeWeb - share links.md");
    expect([result.stdout, readFileSync(path, "utf8")]).toEqual([
      `${path}\n`,
      `---
tags:
  - dump
  - AIGenerated
  - ClaudeWeb
---
Session: Claude web · https://claude.ai/chat/123 · 2026-10-05 19:40 · [[Brain-Dump]]

${BODY}`,
    ]);
  });

  test("leaves out the URL and project when neither is given", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = run(sandbox, ["write-dump", "--tool", "Gemini", "--slug", "papers", "--at", DUMP_AT], { stdin: BODY });

    // #then
    expect(readFileSync(result.stdout.trim(), "utf8").split("\n")[6]).toBe("Session: Gemini · 2026-10-05 19:40");
  });

  test("rejects chat-only options for a dev Session tool", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = run(sandbox, ["write-dump", "--tool", "Codex", "--slug", "s", "--chat-url", "https://x"], { stdin: BODY });

    // #then
    expect([result.exitCode, result.stderr]).toEqual([
      2,
      "brain-dump: --chat-url and --project are only for chat tools (ClaudeWeb, ChatGPT, Gemini)\n",
    ]);
  });

  test("rejects a pasted body that carries its own frontmatter", () => {
    // #given
    const sandbox = makeSandbox();
    const pasted = `---\ntags: [notes]\n---\n${BODY}`;

    // #when
    const result = run(sandbox, ["write-dump", "--tool", "ChatGPT", "--slug", "s", "--at", DUMP_AT], { stdin: pasted });

    // #then
    expect([result.exitCode, result.stderr]).toEqual([1, 'brain-dump: invalid Dump body: line 1 is not an Item: "---"\n']);
  });
});
