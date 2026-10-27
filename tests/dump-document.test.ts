import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseDumpBody } from "../src/dump-body.ts";
import { parseDump, renderDump, type DumpDocument } from "../src/dump.ts";
import type { DevOrigin } from "../src/origin.ts";

const AT = new Date(2026, 9, 5, 19, 40);
const BODY = "## Learnings\n- [ ] Bun runs TypeScript directly.\n\n## Decisions\n- [x] Use Bun.\n\t- Why: one runtime.\n\n## Todos\n- [-] #todo Ship it.\n";
const DEV_ORIGIN: DevOrigin = { kind: "dev", tool: "ClaudeCode", project: "Brain-Dump", location: join(homedir(), "Projects", "Brain-Dump"), branch: "main", at: AT };
const DEV: DumpDocument = {
  origin: DEV_ORIGIN,
  swept: false,
  session: undefined,
  slug: "bun choices",
  body: BODY,
};

describe("the Dump document", () => {
  test("reads back what it writes, for every origin and coverage", () => {
    // #given
    const documents: [string, DumpDocument][] = [
      ["dev", DEV],
      ["dev outside home, no branch", { ...DEV, origin: { ...DEV_ORIGIN, tool: "Codex", project: "scratch", location: "/srv/scratch", branch: undefined } }],
      ["covered", { ...DEV, session: { id: "0199-abc_d.e", through: new Date("2026-10-05T18:02:11.500Z") } }],
      [
        "swept, with notes",
        { ...DEV, swept: true, origin: { ...DEV_ORIGIN, notes: ["earlier part missing", "truncated"] }, session: { id: "s-1", through: AT } },
      ],
      ["chat with URL and Project", { ...DEV, origin: { kind: "chat", tool: "ClaudeWeb", chatUrl: "https://claude.ai/chat/123", project: "Brain-Dump", at: AT } }],
      ["chat without Project", { ...DEV, origin: { kind: "chat", tool: "Gemini", chatUrl: undefined, project: undefined, at: AT } }],
      [
        "Kept Pick from a Briefing",
        { ...DEV, origin: { kind: "briefing", tool: "PaperBot", briefing: "2026-10-05 Daily Briefing", paper: "2410.01234", project: "Interpretability", at: AT } },
      ],
    ];

    // #when
    const read = documents.map(([name, document]) => {
      const { stem, contents } = renderDump(document);
      return [name, parseDump(`${stem}.md`, contents)];
    });

    // #then
    expect(read).toEqual(
      documents.map(([name, { body, ...document }]) => [
        name,
        expect.objectContaining({ ...document, origin: document.origin.kind === "dev" ? { notes: [], ...document.origin } : document.origin, body: parseDumpBody(body, { stored: true }) }),
      ]),
    );
  });

  test("names a dev Dump after its Project and a chat Dump after its tool, whatever Project the chat names", () => {
    // #given
    const chat: DumpDocument = { ...DEV, origin: { kind: "chat", tool: "ClaudeWeb", chatUrl: undefined, project: "Brain-Dump", at: AT } };

    // #when
    const labels = [DEV, chat].map((document) => {
      const { stem, contents } = renderDump(document);
      const parsed = parseDump(`${stem}.md`, contents);
      return [stem, "problem" in parsed ? parsed.problem : parsed.label];
    });

    // #then
    expect(labels).toEqual([
      ["2026-10-05 1940 Brain-Dump - bun choices", "Brain-Dump"],
      ["2026-10-05 1940 ClaudeWeb - bun choices", "ClaudeWeb"],
    ]);
  });

  test("names the problem with a Dump it can't read", () => {
    // #given
    const { stem, contents } = renderDump(DEV);
    const origin = contents.split("\n").find((line) => line.startsWith("Session: ")) ?? "";
    const cases: [string, string, string][] = [
      ["not a Dump filename", "notes.md", contents],
      ["no frontmatter", `${stem}.md`, contents.slice(contents.indexOf("Session: "))],
      ["no origin line", `${stem}.md`, contents.replace(`${origin}\n`, "")],
      ["an origin line it doesn't write", `${stem}.md`, contents.replace(origin, "Session: Claude Code")],
      ["through without session", `${stem}.md`, contents.replace("---\nSession", "through: 2026-10-05T18:00:00.000Z\n---\nSession")],
      ["a Briefing origin without its Paper", `${stem}.md`, contents.replace(origin, "Briefing: [[2026-10-05 Daily Briefing]] · 2026-10-05 19:40 · [[Interpretability]]")],
      ["a bad body", `${stem}.md`, `${contents}loose text\n`],
    ];

    // #when
    const problems = cases.map(([name, filename, text]) => [name, parseDump(filename, text)]);

    // #then
    expect(problems).toEqual([
      ["not a Dump filename", { problem: "not a Dump filename" }],
      ["no frontmatter", { problem: "no frontmatter" }],
      ["no origin line", { problem: "no Session: or Briefing: origin line after the frontmatter" }],
      ["an origin line it doesn't write", { problem: 'unreadable origin line "Session: Claude Code"' }],
      ["through without session", { problem: "through: without session: in the frontmatter" }],
      ["a Briefing origin without its Paper", { problem: "a Briefing: origin line without paper: in the frontmatter" }],
      ["a bad body", { problem: 'invalid Dump body: line 10 is not an Item: "loose text"' }],
    ]);
  });
});
