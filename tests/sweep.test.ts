import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeRepo, makeSandbox, run, writeConfig, writeDumpArgs, type Sandbox } from "./harness.ts";

const NOW = "2026-10-12T04:00:00Z";
const BODY = "## Learnings\n- [ ] Bun ships zstd.\n";

type Message = { role: "user" | "assistant"; text: string; at: string };

let uuids = 0;

/** One Claude Code record, shaped as Claude Code writes it to `~/.claude/projects/<encoded cwd>/<session>.jsonl`. */
function record(session: string, cwd: string, { role, text, at }: Message, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: role,
    uuid: `uuid-${++uuids}`,
    parentUuid: null,
    sessionId: session,
    timestamp: at,
    cwd,
    gitBranch: "main",
    isSidechain: false,
    message: { role, content: role === "user" ? text : [{ type: "text", text }] },
    ...extra,
  };
}

function exchanges(start: string, turns: number, topic = "Question"): Message[] {
  const at = (minutes: number): string => new Date(new Date(start).getTime() + minutes * 60_000).toISOString();
  return Array.from({ length: turns }, (_, turn) => [
    { role: "user" as const, text: `${topic} ${turn + 1}`, at: at(turn * 2) },
    { role: "assistant" as const, text: `Answer ${turn + 1}`, at: at(turn * 2 + 1) },
  ]).flat();
}

function sessionPath(sandbox: Sandbox, cwd: string, name: string): string {
  return join(sandbox.home, ".claude", "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"), name);
}

function writeSession(sandbox: Sandbox, session: string, cwd: string, rows: unknown[], name = `${session}.jsonl`): string {
  const path = sessionPath(sandbox, cwd, name);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, rows.map((row) => (typeof row === "string" ? row : JSON.stringify(row))).join("\n") + "\n");
  return path;
}

function writeSessionLog(sandbox: Sandbox, session: string, cwd: string, start: string, turns = 3, topic = "Question"): string {
  return writeSession(sandbox, session, cwd, exchanges(start, turns, topic).map((message) => record(session, cwd, message)));
}

type Reply = { reply: string; exitCode?: number };

/** A drafting agent stub: saves each prompt it is given, then answers with the first reply whose marker the prompt holds, else `fallback`. */
function stubAgent(sandbox: Sandbox, fallback: string | Reply, byMarker: Record<string, Reply> = {}): Record<string, string> {
  const script = join(sandbox.home, "agent.sh");
  const rules = [...Object.entries(byMarker), ["", typeof fallback === "string" ? { reply: fallback } : fallback] as const].map(([marker, { reply, exitCode = 0 }], index) => {
    const replyFile = join(sandbox.home, `agent-reply-${index}.txt`);
    writeFileSync(replyFile, reply);
    return `if grep -qF -- '${marker}' "$p"; then cat '${replyFile}'; exit ${exitCode}; fi`;
  });
  writeFileSync(script, `#!/bin/sh\nmkdir -p "$HOME/prompts"\np="$HOME/prompts/$(ls "$HOME/prompts" | wc -l | tr -d ' ' | xargs printf %03d).txt"\ncat > "$p"\n${rules.join("\n")}\n`);
  chmodSync(script, 0o755);
  return { BRAIN_DUMP_DRAFT_AGENT: script };
}

function prompts(sandbox: Sandbox): string[] {
  const folder = join(sandbox.home, "prompts");
  return existsSync(folder) ? readdirSync(folder).sort().map((name) => readFileSync(join(folder, name), "utf8")) : [];
}

function inbox(sandbox: Sandbox): string[] {
  const folder = join(sandbox.vault, "Inbox");
  return existsSync(folder) ? readdirSync(folder).filter((name) => name.endsWith(".md")).sort() : [];
}

type Summary = {
  time: string;
  run: string | null;
  written: { session: string; dump: string }[];
  skipped: { session: string }[];
  unreadable: { file: string }[];
  secretRefused: { session: string; line: number; kind: string }[];
  carriedOver: { session: string }[];
  errors: { session?: string; error: string }[];
};

function sweep(sandbox: Sandbox, env: Record<string, string>, now = NOW) {
  const result = run(sandbox, ["sweep"], { now, env });
  return { ...result, summary: (result.exitCode === 0 ? JSON.parse(result.stdout) : undefined) as Summary };
}

function firstDump(sandbox: Sandbox, summary: Summary): string {
  return readFileSync(join(sandbox.vault, summary.written[0]?.dump ?? ""), "utf8");
}

describe("sweep drafts each uncaptured Claude Code Session into a Dump", () => {
  test("writes one swept Dump in the Inbox, covering the Session through its last record", () => {
    // #given
    const sandbox = makeSandbox();
    const repo = makeRepo(sandbox, "Brain-Dump", "main");
    writeSessionLog(sandbox, "s-1", repo, "2026-10-11T15:00:00Z");

    // #when
    const result = sweep(sandbox, stubAgent(sandbox, `Slug: bun zstd\n${BODY}`));

    // #then
    const name = "2026-10-11 1505 Brain-Dump - bun zstd.md";
    expect({ exitCode: result.exitCode, stderr: result.stderr, inbox: inbox(sandbox), dump: readFileSync(join(sandbox.vault, "Inbox", name), "utf8") }).toEqual({
      exitCode: 0,
      stderr: "",
      inbox: [name],
      dump: `---\ntags:\n  - dump\n  - dump/swept\n  - AIGenerated\n  - ClaudeCode\nsession: s-1\nthrough: 2026-10-11T15:05:00.000Z\n---\nSession: Claude Code (swept) · \`~/Projects/Brain-Dump\` @ \`main\` · 2026-10-11 15:05 · [[Brain-Dump]]\n\n${BODY}`,
    });
  });
});

const EMPTY = { run: null, written: [], skipped: [], unreadable: [], secretRefused: [], carriedOver: [], errors: [] };

describe("sweep leaves out Sessions it should not draft", () => {
  const cases: [string, (sandbox: Sandbox, repo: string) => void][] = [
    ["a subagent transcript", (sandbox, repo) => writeSession(sandbox, "s-1", repo, exchanges("2026-10-11T15:00:00Z", 3).map((message) => record("s-1", repo, message)), "s-1/subagents/agent-a1.jsonl")],
    ["an older-style agent- transcript", (sandbox, repo) => writeSession(sandbox, "agent-a1", repo, exchanges("2026-10-11T15:00:00Z", 3).map((message) => record("agent-a1", repo, message)))],
    ["an .orphaned- copy", (sandbox, repo) => writeSession(sandbox, "s-1", repo, exchanges("2026-10-11T15:00:00Z", 3).map((message) => record("s-1", repo, message)), "s-1.orphaned-20261011-ab12.jsonl")],
    ["a .superseded- copy", (sandbox, repo) => writeSession(sandbox, "s-1", repo, exchanges("2026-10-11T15:00:00Z", 3).map((message) => record("s-1", repo, message)), "s-1.jsonl.superseded-20261011")],
    ["a Session active in the last 2 hours", (sandbox, repo) => writeSessionLog(sandbox, "s-1", repo, "2026-10-12T02:10:00Z")],
    ["a Session last active more than 28 days ago", (sandbox, repo) => writeSessionLog(sandbox, "s-1", repo, "2026-09-13T15:00:00Z")],
    ["a Session with fewer than 3 user messages", (sandbox, repo) => writeSessionLog(sandbox, "s-1", repo, "2026-10-11T15:00:00Z", 2)],
    ["a Session inside the Vault", (sandbox) => writeSessionLog(sandbox, "s-1", join(sandbox.vault, "Research"), "2026-10-11T15:00:00Z")],
    [
      "a Session in an opted-out repo",
      (sandbox, repo) => {
        writeConfig(sandbox, "sweep-opt-out = ~/Elsewhere, ~/Projects/Brain-Dump\n");
        writeSessionLog(sandbox, "s-1", join(repo, "src"), "2026-10-11T15:00:00Z");
      },
    ],
    [
      "a Session covered by a Dump in the Inbox",
      (sandbox, repo) => {
        writeSessionLog(sandbox, "s-1", repo, "2026-10-11T15:00:00Z");
        run(sandbox, [...writeDumpArgs("manual"), "--session", "s-1", "--through", "2026-10-11T15:05:00Z"], { stdin: BODY });
      },
    ],
    [
      "a Session covered by a filed Dump",
      (sandbox, repo) => {
        writeSessionLog(sandbox, "s-1", repo, "2026-10-11T15:00:00Z");
        mkdirSync(join(sandbox.vault, "Inbox", "Filed"), { recursive: true });
        writeFileSync(join(sandbox.vault, "Inbox", "Filed", "2026-10-11 1505 Brain-Dump - manual.md"), `---\ntags:\n  - dump\nsession: s-1\nthrough: 2026-10-11T15:06:00.000Z\n---\nSession: Claude Code\n\n${BODY}`);
      },
    ],
  ];

  for (const [name, arrange] of cases) {
    test(`skips ${name} without drafting it`, () => {
      // #given
      const sandbox = makeSandbox();
      const repo = makeRepo(sandbox, "Brain-Dump", "main");
      arrange(sandbox, repo);
      const before = inbox(sandbox);

      // #when
      const result = sweep(sandbox, stubAgent(sandbox, `Slug: s\n${BODY}`));

      // #then
      expect({ exitCode: result.exitCode, summary: result.summary, prompts: prompts(sandbox), inbox: inbox(sandbox) }).toEqual({
        exitCode: 0,
        summary: { time: "2026-10-12T04:00:00.000Z", ...EMPTY },
        prompts: [],
        inbox: before,
      });
    });
  }

  test("never reports an unreadable log from the Vault or an opted-out repo", () => {
    // #given
    const sandbox = makeSandbox();
    const repo = makeRepo(sandbox, "Brain-Dump", "main");
    writeConfig(sandbox, `sweep-opt-out = ${repo}\n`);
    for (const [session, cwd] of [["s-vault", sandbox.vault], ["s-opted", repo]] as const) {
      writeSession(sandbox, session, cwd, [{ type: "message-v9", timestamp: "2026-10-11T15:00:00Z", cwd, payload: {} }]);
    }

    // #when
    const result = sweep(sandbox, stubAgent(sandbox, `Slug: s\n${BODY}`));

    // #then
    expect(result.summary.unreadable).toEqual([]);
  });

  test("drafts a Session left out while active once it has gone quiet, on the next day's Sweep", () => {
    // #given
    const sandbox = makeSandbox();
    const repo = makeRepo(sandbox, "Brain-Dump", "main");
    writeSessionLog(sandbox, "s-1", repo, "2026-10-12T02:10:00Z");
    const env = stubAgent(sandbox, `Slug: s\n${BODY}`);
    sweep(sandbox, env);

    // #when
    const result = sweep(sandbox, env, "2026-10-13T04:00:00Z");

    // #then
    expect(result.summary.written).toEqual([{ session: "s-1", dump: "Inbox/2026-10-12 0215 Brain-Dump - s.md" }]);
  });

  test("does not read again a Session with no records since the last Sweep", () => {
    // #given
    const sandbox = makeSandbox();
    const repo = makeRepo(sandbox, "Brain-Dump", "main");
    writeSessionLog(sandbox, "s-1", repo, "2026-10-11T15:00:00Z");
    sweep(sandbox, stubAgent(sandbox, "No Items"));

    // #when
    const result = sweep(sandbox, stubAgent(sandbox, `Slug: s\n${BODY}`), "2026-10-13T04:00:00Z");

    // #then
    expect({ summary: result.summary, prompts: prompts(sandbox).length }).toEqual({ summary: { time: "2026-10-13T04:00:00.000Z", ...EMPTY }, prompts: 1 });
  });
});

describe("sweep reads only what a Session said", () => {
  test("gives the agent user and assistant text in order, once per uuid, leaving out tool calls, tool results, sidechains and unknown records", () => {
    // #given
    const sandbox = makeSandbox();
    const repo = makeRepo(sandbox, "Brain-Dump", "main");
    const [ask, answer, ...rest] = exchanges("2026-10-11T15:00:00Z", 3).map((message) => record("s-1", repo, message));
    writeSession(sandbox, "s-1", repo, [
      { type: "file-history-snapshot", messageId: "m", snapshot: {} },
      ask,
      ask,
      "not json {",
      { ...record("s-1", repo, { role: "assistant", text: "", at: "2026-10-11T15:00:30Z" }), message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: "ls secret-dir" } }, { type: "thinking", thinking: "hmm" }] } },
      { ...record("s-1", repo, { role: "user", text: "", at: "2026-10-11T15:00:40Z" }), message: { role: "user", content: [{ type: "tool_result", content: "tool output here" }] } },
      record("s-1", repo, { role: "user", text: "Sidechain chatter", at: "2026-10-11T15:00:50Z" }, { isSidechain: true }),
      answer,
      ...rest,
    ]);

    // #when
    sweep(sandbox, stubAgent(sandbox, `Slug: s\n${BODY}`));

    // #then
    const prompt = prompts(sandbox)[0] ?? "";
    expect(prompt.slice(prompt.indexOf("## Transcript"))).toBe(
      "## Transcript\n\n" +
        ["15:00] User:\nQuestion 1", "15:01] Assistant:\nAnswer 1", "15:02] User:\nQuestion 2", "15:03] Assistant:\nAnswer 2", "15:04] User:\nQuestion 3", "15:05] Assistant:\nAnswer 3"]
          .map((line) => `[2026-10-11 ${line}`)
          .join("\n\n"),
    );
  });

  test("gives the agent the shared Item rules and the reply contract", () => {
    // #given
    const sandbox = makeSandbox();
    const repo = makeRepo(sandbox, "Brain-Dump", "main");
    writeSessionLog(sandbox, "s-1", repo, "2026-10-11T15:00:00Z");

    // #when
    sweep(sandbox, stubAgent(sandbox, `Slug: s\n${BODY}`));

    // #then
    const prompt = prompts(sandbox)[0] ?? "";
    const rules = readFileSync(join(import.meta.dir, "..", "skills", "dump", "item-rules.md"), "utf8");
    expect({ rules: prompt.includes(rules), contract: prompt.includes("A line `Slug: <slug>`") && prompt.includes("reply with exactly `No Items`") }).toEqual({ rules: true, contract: true });
  });

  test("drafts a resumed Session only from the records after its Dump's through", () => {
    // #given
    const sandbox = makeSandbox();
    const repo = makeRepo(sandbox, "Brain-Dump", "main");
    const rows = [...exchanges("2026-10-11T15:00:00Z", 3, "Early"), ...exchanges("2026-10-11T18:00:00Z", 3, "Later")].map((message) => record("s-1", repo, message));
    writeSession(sandbox, "s-1", repo, rows);
    run(sandbox, [...writeDumpArgs("manual"), "--session", "s-1", "--through", "2026-10-11T15:05:00Z"], { stdin: BODY });

    // #when
    const result = sweep(sandbox, stubAgent(sandbox, `Slug: s\n${BODY}`));

    // #then
    const prompt = prompts(sandbox)[0] ?? "";
    const dump = firstDump(sandbox, result.summary);
    expect({ early: prompt.includes("Early 1"), later: prompt.includes("Later 1"), through: dump.includes("through: 2026-10-11T18:05:00.000Z") }).toEqual({ early: false, later: true, through: true });
  });

  test("notes in the origin line that a transcript starting at a compaction has lost its earlier part", () => {
    // #given
    const sandbox = makeSandbox();
    const repo = makeRepo(sandbox, "Brain-Dump", "main");
    const boundary = { type: "system", subtype: "compact_boundary", timestamp: "2026-10-11T14:59:00Z", compactMetadata: { trigger: "auto" } };
    writeSession(sandbox, "s-1", repo, [{ type: "permission-mode", permissionMode: "default" }, boundary, ...exchanges("2026-10-11T15:00:00Z", 3).map((message) => record("s-1", repo, message))]);

    // #when
    const result = sweep(sandbox, stubAgent(sandbox, `Slug: s\n${BODY}`));

    // #then
    expect(firstDump(sandbox, result.summary)).toContain(" · 2026-10-11 15:05 · (earlier part missing) · [[Brain-Dump]]\n");
  });

  test("keeps the head and tail of an overlong transcript and says so in the origin line", () => {
    // #given
    const sandbox = makeSandbox();
    const repo = makeRepo(sandbox, "Brain-Dump", "main");
    const filler = "x".repeat(80_000);
    const messages: Message[] = [
      { role: "user", text: `HEAD ${filler}`, at: "2026-10-11T15:00:00Z" },
      { role: "user", text: `${filler} MIDDLE ${filler}`, at: "2026-10-11T15:02:00Z" },
      { role: "user", text: `${filler} TAIL`, at: "2026-10-11T15:05:00Z" },
    ];
    writeSession(sandbox, "s-1", repo, messages.map((message) => record("s-1", repo, message)));

    // #when
    const result = sweep(sandbox, stubAgent(sandbox, `Slug: s\n${BODY}`));

    // #then
    const prompt = prompts(sandbox)[0] ?? "";
    const transcript = prompt.slice(prompt.indexOf("## Transcript\n\n") + "## Transcript\n\n".length);
    const dump = firstDump(sandbox, result.summary);
    expect({
      head: transcript.includes("HEAD"),
      middle: transcript.includes("MIDDLE"),
      tail: transcript.includes("TAIL"),
      cut: /\[… \d+ characters left out …\]/.test(transcript),
      size: transcript.length < 151_000,
      origin: dump.includes(" · 2026-10-11 15:05 · (truncated) · [[Brain-Dump]]\n"),
    }).toEqual({ head: true, middle: false, tail: true, cut: true, size: true, origin: true });
  });
});

describe("sweep reports and retries a file it cannot read", () => {
  test("reports a log with no user messages as unreadable, drafts nothing from it, and reads it again next time", () => {
    // #given
    const sandbox = makeSandbox();
    const repo = makeRepo(sandbox, "Brain-Dump", "main");
    const file = writeSession(sandbox, "s-1", repo, [{ type: "message-v9", timestamp: "2026-10-11T15:00:00Z", payload: { text: "Question 1" } }]);
    const env = stubAgent(sandbox, `Slug: s\n${BODY}`);

    // #when
    const first = sweep(sandbox, env);
    const second = sweep(sandbox, env, "2026-10-13T04:00:00Z");

    // #then
    expect({ first: first.summary.unreadable, second: second.summary.unreadable, prompts: prompts(sandbox), inbox: inbox(sandbox) }).toEqual({
      first: [{ file }],
      second: [{ file }],
      prompts: [],
      inbox: [],
    });
  });
});

describe("sweep is bounded", () => {
  test("drafts the 25 newest Sessions and carries the rest over to the next Sweep", () => {
    // #given
    const sandbox = makeSandbox();
    const repo = makeRepo(sandbox, "Brain-Dump", "main");
    for (let n = 1; n <= 27; n++) writeSessionLog(sandbox, `s-${String(n).padStart(2, "0")}`, repo, new Date(Date.parse("2026-10-11T00:00:00Z") + n * 30 * 60_000).toISOString(), 3, `Topic ${n}`);
    const env = stubAgent(sandbox, "No Items");

    // #when
    const first = sweep(sandbox, env, "2026-10-12T04:00:00Z");
    const second = sweep(sandbox, env, "2026-10-13T04:00:00Z");

    // #then
    expect({ skipped: first.summary.skipped.length, newest: first.summary.skipped[0], carried: first.summary.carriedOver, next: second.summary.skipped }).toEqual({
      skipped: 25,
      newest: { session: "s-27" },
      carried: [{ session: "s-02" }, { session: "s-01" }],
      next: [{ session: "s-02" }, { session: "s-01" }],
    });
  });
});

describe("sweep handles what the drafting agent does", () => {
  test("records a Session with no Items in the skip ledger and writes no Dump for it", () => {
    // #given
    const sandbox = makeSandbox();
    const repo = makeRepo(sandbox, "Brain-Dump", "main");
    writeSessionLog(sandbox, "s-1", repo, "2026-10-11T15:00:00Z");

    // #when
    const result = sweep(sandbox, stubAgent(sandbox, "No Items\n"));

    // #then
    expect({ summary: result.summary, inbox: inbox(sandbox) }).toEqual({ summary: { time: "2026-10-12T04:00:00.000Z", ...EMPTY, skipped: [{ session: "s-1" }] }, inbox: [] });
  });

  test("stops at an agent failure, writes what it drafted, and retries the rest but not the ledgered Session next time", () => {
    // #given
    const sandbox = makeSandbox();
    const repo = makeRepo(sandbox, "Brain-Dump", "main");
    writeSessionLog(sandbox, "s-new", repo, "2026-10-11T20:00:00Z", 3, "Newest");
    writeSessionLog(sandbox, "s-mid", repo, "2026-10-11T18:00:00Z", 3, "Middle");
    writeSessionLog(sandbox, "s-old", repo, "2026-10-11T15:00:00Z", 3, "Oldest");
    writeSessionLog(sandbox, "s-oldest", repo, "2026-10-11T12:00:00Z", 3, "Ancient");
    const failing = stubAgent(sandbox, `Slug: newest\n${BODY}`, { Middle: { reply: "No Items" }, Oldest: { reply: "rate limited", exitCode: 1 } });

    // #when
    const first = sweep(sandbox, failing);
    const second = sweep(sandbox, stubAgent(sandbox, `Slug: retried\n${BODY}`), "2026-10-13T04:00:00Z");

    // #then
    expect({ first: first.summary, retried: second.summary.written.map(({ session }) => session), inbox: inbox(sandbox) }).toEqual({
      first: {
        time: "2026-10-12T04:00:00.000Z",
        ...EMPTY,
        run: expect.any(String),
        written: [{ session: "s-new", dump: "Inbox/2026-10-11 2005 Brain-Dump - newest.md" }],
        skipped: [{ session: "s-mid" }],
        carriedOver: [{ session: "s-old" }, { session: "s-oldest" }],
        errors: [{ session: "s-old", error: "drafting agent failed (exit 1): rate limited" }],
      },
      retried: ["s-old", "s-oldest"],
      inbox: ["2026-10-11 1205 Brain-Dump - retried.md", "2026-10-11 1505 Brain-Dump - retried.md", "2026-10-11 2005 Brain-Dump - newest.md"],
    });
  });

  test("reports and skips a body that breaks the Dump rules, and goes on", () => {
    // #given
    const sandbox = makeSandbox();
    const repo = makeRepo(sandbox, "Brain-Dump", "main");
    writeSessionLog(sandbox, "s-bad", repo, "2026-10-11T18:00:00Z", 3, "Bad");
    writeSessionLog(sandbox, "s-good", repo, "2026-10-11T15:00:00Z", 3, "Good");
    const env = stubAgent(sandbox, `Slug: good\n${BODY}`, { Bad: { reply: "Slug: bad\n## Notes\n- [ ] x\n" } });

    // #when
    const result = sweep(sandbox, env);

    // #then
    expect({ written: result.summary.written.map(({ session }) => session), errors: result.summary.errors }).toEqual({
      written: ["s-good"],
      errors: [{ session: "s-bad", error: 'invalid draft: invalid Dump body: unexpected section "## Notes"' }],
    });
  });

  test("treats a reply outside the output contract as an agent failure and stops", () => {
    // #given
    const sandbox = makeSandbox();
    const repo = makeRepo(sandbox, "Brain-Dump", "main");
    writeSessionLog(sandbox, "s-junk", repo, "2026-10-11T20:00:00Z", 3, "Junk");
    writeSessionLog(sandbox, "s-good", repo, "2026-10-11T15:00:00Z", 3, "Good");
    const env = stubAgent(sandbox, `Slug: good\n${BODY}`, { Junk: { reply: "Error: credit balance too low" } });

    // #when
    const result = sweep(sandbox, env);

    // #then
    expect({ written: result.summary.written, carriedOver: result.summary.carriedOver, errors: result.summary.errors }).toEqual({
      written: [],
      carriedOver: [{ session: "s-junk" }, { session: "s-good" }],
      errors: [{ session: "s-junk", error: "drafting agent replied outside its output contract: Error: credit balance too low" }],
    });
  });

  test("accepts a body wrapped in a markdown fence", () => {
    // #given
    const sandbox = makeSandbox();
    const repo = makeRepo(sandbox, "Brain-Dump", "main");
    writeSessionLog(sandbox, "s-1", repo, "2026-10-11T15:00:00Z");

    // #when
    const result = sweep(sandbox, stubAgent(sandbox, `Slug: s\n\n\`\`\`markdown\n${BODY}\`\`\`\n`));

    // #then
    expect(firstDump(sandbox, result.summary).endsWith(`\n\n${BODY}`)).toBe(true);
  });

  test("refuses a draft holding a secret, naming its line and kind but never the secret", () => {
    // #given
    const sandbox = makeSandbox();
    const repo = makeRepo(sandbox, "Brain-Dump", "main");
    writeSessionLog(sandbox, "s-1", repo, "2026-10-11T15:00:00Z");
    const secret = "ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

    // #when
    const result = sweep(sandbox, stubAgent(sandbox, `Slug: s\n## Learnings\n- [ ] The token is ${secret}.\n`));

    // #then
    expect({ summary: result.summary, leaked: result.stdout.includes(secret), inbox: inbox(sandbox) }).toEqual({
      summary: { time: "2026-10-12T04:00:00.000Z", ...EMPTY, secretRefused: [{ session: "s-1", line: 2, kind: "a GitHub token" }] },
      leaked: false,
      inbox: [],
    });
  });
});

describe("sweep when the Dumps can't be written", () => {
  test("reports the failure and drafts the same Sessions again next time", () => {
    // #given
    const sandbox = makeSandbox();
    const repo = makeRepo(sandbox, "Brain-Dump", "main");
    writeSessionLog(sandbox, "s-1", repo, "2026-10-11T15:00:00Z");
    const env = stubAgent(sandbox, `Slug: s\n${BODY}`);
    const inboxFolder = join(sandbox.vault, "Inbox");
    mkdirSync(inboxFolder);
    chmodSync(inboxFolder, 0o500);
    const first = sweep(sandbox, env);
    chmodSync(inboxFolder, 0o755);

    // #when
    const second = sweep(sandbox, env, "2026-10-13T04:00:00Z");

    // #then
    expect({ written: first.summary.written, errors: first.summary.errors, retried: second.summary.written }).toEqual({
      written: [],
      errors: [{ error: "no Dumps written: could not write to the Vault: permission denied" }],
      retried: [{ session: "s-1", dump: "Inbox/2026-10-11 1505 Brain-Dump - s.md" }],
    });
  });
});

describe("sweep keeps a carried-over Session until it is written", () => {
  test("retries a carried-over Session whose Dump could not be written", () => {
    // #given
    const sandbox = makeSandbox();
    const repo = makeRepo(sandbox, "Brain-Dump", "main");
    for (let n = 1; n <= 26; n++) writeSessionLog(sandbox, `s-${String(n).padStart(2, "0")}`, repo, new Date(Date.parse("2026-10-11T00:00:00Z") + n * 30 * 60_000).toISOString(), 3, `Topic ${n}`);
    sweep(sandbox, stubAgent(sandbox, "No Items"));
    const env = stubAgent(sandbox, `Slug: s\n${BODY}`);
    const inboxFolder = join(sandbox.vault, "Inbox");
    mkdirSync(inboxFolder, { recursive: true });
    chmodSync(inboxFolder, 0o500);
    sweep(sandbox, env, "2026-10-13T04:00:00Z");
    chmodSync(inboxFolder, 0o755);

    // #when
    const result = sweep(sandbox, env, "2026-10-14T04:00:00Z");

    // #then
    expect(result.summary.written.map(({ session }) => session)).toEqual(["s-01"]);
  });
});

describe("one Sweep is one Run", () => {
  test("journals every Dump it wrote as a single sweep Run that undo reverses", () => {
    // #given
    const sandbox = makeSandbox();
    const repo = makeRepo(sandbox, "Brain-Dump", "main");
    writeSessionLog(sandbox, "s-1", repo, "2026-10-11T15:00:00Z", 3, "First");
    writeSessionLog(sandbox, "s-2", repo, "2026-10-11T18:00:00Z", 3, "Second");
    const result = sweep(sandbox, stubAgent(sandbox, `Slug: s\n${BODY}`));

    // #when
    const runs = JSON.parse(run(sandbox, ["runs"], { now: NOW }).stdout);
    const undo = run(sandbox, ["undo", String(result.summary.run), "--confirm"], { now: NOW });

    // #then
    expect({ runs, undo: undo.exitCode, inbox: inbox(sandbox) }).toEqual({
      runs: [{ id: result.summary.run, time: "2026-10-12T04:00:00.000Z", command: "sweep", label: "swept 2 Dumps", files: 2, status: "applied" }],
      undo: 0,
      inbox: [],
    });
  });
});

describe("sweep --last", () => {
  test("prints the last Sweep's summary", () => {
    // #given
    const sandbox = makeSandbox();
    const repo = makeRepo(sandbox, "Brain-Dump", "main");
    writeSessionLog(sandbox, "s-1", repo, "2026-10-11T15:00:00Z");
    const swept = sweep(sandbox, stubAgent(sandbox, "No Items"));

    // #when
    const result = run(sandbox, ["sweep", "--last"]);

    // #then
    expect({ exitCode: result.exitCode, summary: JSON.parse(result.stdout) }).toEqual({ exitCode: 0, summary: swept.summary });
  });

  test("says so when no Sweep has run", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = run(sandbox, ["sweep", "--last"]);

    // #then
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 1, stderr: "brain-dump: no Sweep has run on this machine\n" });
  });
});

describe("the Sweep's per-machine lock", () => {
  function lock(sandbox: Sandbox, pid: number): void {
    const folder = join(sandbox.home, ".local", "state", "brain-dump");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "sweep.lock"), String(pid));
  }

  test("refuses to start while another Sweep holds it", () => {
    // #given
    const sandbox = makeSandbox();
    const repo = makeRepo(sandbox, "Brain-Dump", "main");
    writeSessionLog(sandbox, "s-1", repo, "2026-10-11T15:00:00Z");
    lock(sandbox, process.pid);

    // #when
    const result = sweep(sandbox, stubAgent(sandbox, `Slug: s\n${BODY}`));

    // #then
    expect({ exitCode: result.exitCode, stderr: result.stderr, prompts: prompts(sandbox) }).toEqual({ exitCode: 1, stderr: `brain-dump: another Sweep is running (pid ${process.pid})\n`, prompts: [] });
  });

  test("takes over a lock left by a Sweep that is gone, and releases it", () => {
    // #given
    const sandbox = makeSandbox();
    const repo = makeRepo(sandbox, "Brain-Dump", "main");
    writeSessionLog(sandbox, "s-1", repo, "2026-10-11T15:00:00Z");
    const gone = Bun.spawnSync(["true"]).pid;
    lock(sandbox, gone);

    // #when
    const result = sweep(sandbox, stubAgent(sandbox, `Slug: s\n${BODY}`));

    // #then
    expect({ exitCode: result.exitCode, written: result.summary.written.length, locked: existsSync(join(sandbox.home, ".local", "state", "brain-dump", "sweep.lock")) }).toEqual({ exitCode: 0, written: 1, locked: false });
  });
});
