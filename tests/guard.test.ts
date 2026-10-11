import { describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { makeSandbox, run, type Sandbox } from "./harness.ts";

function guard(sandbox: Sandbox, tool: string, input: Record<string, unknown>, cwd = sandbox.home, env: Record<string, string> = {}) {
  return guardRaw(sandbox, JSON.stringify({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: input, cwd }), env);
}

function guardRaw(sandbox: Sandbox, hookInput: string, env: Record<string, string> = {}) {
  const { exitCode, stderr } = run(sandbox, ["guard"], { stdin: hookInput, env });
  return { exitCode, stderr };
}

function blocked(tool: string, target: string) {
  return { exitCode: 2, stderr: `Vault access goes through brain-dump only (recall, show, write-dump, file). Blocked: ${tool} on ${target}.\n` };
}

const ALLOWED = { exitCode: 0, stderr: "" };

describe("guard on file tools", () => {
  test("denies an Edit inside the Vault", () => {
    // #given
    const sandbox = makeSandbox();
    const note = join(sandbox.vault, "Research", "Note.md");

    // #when
    const result = guard(sandbox, "Edit", { file_path: note, old_string: "a", new_string: "b" });

    // #then
    expect(result).toEqual(blocked("Edit", note));
  });

  const denied: [string, string, (sandbox: Sandbox) => { input: Record<string, unknown>; cwd?: string; target: string }][] = [
    ["Write to a new note in a new folder", "Write", ({ vault }) => ({ input: { file_path: join(vault, "New", "Deep", "N.md"), content: "x" }, target: join(vault, "New", "Deep", "N.md") })],
    ["NotebookEdit on a notebook in the Vault", "NotebookEdit", ({ vault }) => ({ input: { notebook_path: join(vault, "n.ipynb"), new_source: "x" }, target: join(vault, "n.ipynb") })],
    ["MultiEdit on a note in the Vault", "MultiEdit", ({ vault }) => ({ input: { file_path: join(vault, "N.md"), edits: [] }, target: join(vault, "N.md") })],
    ["Read of a note in the Vault", "Read", ({ vault }) => ({ input: { file_path: join(vault, "N.md") }, target: join(vault, "N.md") })],
    ["Grep with a path", "Grep", ({ vault }) => ({ input: { pattern: "x", path: vault }, target: vault })],
    ["Grep with no path, run from inside the Vault", "Grep", ({ vault }) => ({ input: { pattern: "x" }, cwd: join(vault, "Inbox"), target: join(vault, "Inbox") })],
    ["Glob with no path, run from the Vault root", "Glob", ({ vault }) => ({ input: { pattern: "**/*.md" }, cwd: vault, target: vault })],
    ["Glob with an absolute pattern into the Vault", "Glob", ({ vault }) => ({ input: { pattern: join(vault, "**", "*.md") }, target: vault })],
    ["Read with a path relative to cwd", "Read", ({ home, vault }) => ({ input: { file_path: "Documents/The Vault/N.md" }, cwd: home, target: join(vault, "N.md") })],
    ["Read with a ..-path climbing back into the Vault", "Read", ({ vault }) => ({ input: { file_path: join(vault, "..", "The Vault", "N.md") }, target: join(vault, "N.md") })],
    [
      "Read through a symlink to the Vault",
      "Read",
      ({ home }) => {
        symlinkSync(join(home, "Documents", "The Vault"), join(home, "notes"));
        return { input: { file_path: join(home, "notes", "N.md") }, target: join(home, "notes", "N.md") };
      },
    ],
  ];

  test.each(denied)("denies %s", (_, tool, setup) => {
    // #given
    const sandbox = makeSandbox();
    const { input, cwd, target } = setup(sandbox);

    // #when
    const result = guard(sandbox, tool, input, cwd);

    // #then
    expect(result).toEqual(blocked(tool, target));
  });

  const allowed: [string, string, (sandbox: Sandbox) => { input: Record<string, unknown>; cwd?: string }][] = [
    ["Edit outside the Vault", "Edit", ({ home }) => ({ input: { file_path: join(home, "Projects", "x.ts") } })],
    [
      "Read in a sibling folder whose name starts with the Vault's",
      "Read",
      ({ home }) => {
        mkdirSync(join(home, "Documents", "The Vault 2"));
        return { input: { file_path: join(home, "Documents", "The Vault 2", "N.md") } };
      },
    ],
    ["Grep with no path, run outside the Vault", "Grep", ({ home }) => ({ input: { pattern: "Vault" }, cwd: home })],
    ["a tool the guard doesn't cover", "WebFetch", ({ vault }) => ({ input: { url: `file://${vault}` } })],
  ];

  test.each(allowed)("allows %s", (_, tool, setup) => {
    // #given
    const sandbox = makeSandbox();
    const { input, cwd } = setup(sandbox);

    // #when
    const result = guard(sandbox, tool, input, cwd);

    // #then
    expect(result).toEqual(ALLOWED);
  });
});


describe("guard on shell tools", () => {
  const MENTION = "Vault mention in command";
  const NOTE = "~/Documents/The\\ Vault/N.md";

  const denied: [string, string, string][] = [
    ["a backslash-escaped Vault path", "Bash", `cat ${NOTE}`],
    ["a double-quoted Vault path", "Bash", 'ls "$HOME/Documents/The Vault"'],
    ["a single-quoted Vault folder name", "Bash", "grep -r todo 'The Vault'"],
    ["the Vault name in another case", "Bash", "ls ~/documents/the\\ vault"],
    ["a brain-dump call chained with ;", "Bash", `brain-dump recall x; rm ${NOTE}`],
    ["a brain-dump call chained with &&", "Bash", `brain-dump recall x && cat ${NOTE}`],
    ["a brain-dump call chained with ||", "Bash", `brain-dump recall x || cat ${NOTE}`],
    ["a brain-dump call backgrounded before another", "Bash", `brain-dump recall x & rm ${NOTE}`],
    ["a brain-dump call piped on", "Bash", `brain-dump recall x | tee ${NOTE}`],
    ["a brain-dump call with $( )", "Bash", `brain-dump recall "$(cat ${NOTE})"`],
    ["a brain-dump call with backticks", "Bash", `brain-dump recall \`cat ${NOTE}\``],
    ["a brain-dump call redirected", "Bash", `brain-dump vault > ${NOTE}`],
    ["a brain-dump call reading a redirect", "Bash", `brain-dump apply < ${NOTE}`],
    ["a second command on the next line", "Bash", `brain-dump vault\ncat ${NOTE}`],
    ["a cd into the Vault before brain-dump", "Bash", "cd ~/Documents/The\\ Vault && brain-dump recall x"],
    ["an unquoted heredoc", "Bash", "brain-dump write-dump --tool ClaudeCode --slug s <<EOF\n$(cat ~/Documents/The\\ Vault/N.md)\nEOF"],
    ["two heredocs", "Bash", "brain-dump apply <<'A' <<'B'\nThe Vault\nA\nx\nB"],
    ["a command after the heredoc's end", "Bash", `brain-dump apply <<'EOF'\n{}\nEOF\nrm ${NOTE}`],
    ["a heredoc that never ends", "Bash", "brain-dump apply <<'EOF'\nThe Vault"],
    ["a second command hidden behind a quote in a comment", "Bash", `brain-dump show x #'\ncat ${NOTE}\n#'`],
    ["a second command hidden behind an ANSI-C quote", "Bash", `brain-dump show $'\\''\ncat ${NOTE}\n'`],
    ["a zsh process substitution", "Bash", `brain-dump show =(cp ${NOTE} /tmp/x)`],
    ["a zsh glob qualifier", "Bash", `brain-dump show ${NOTE}(e:'rm -rf ~':)`],
    ["a zsh evaluating expansion", "Bash", `brain-dump show "\${(e)x}" ${NOTE}`],
    ["a command that isn't brain-dump", "PowerShell", 'Get-Content "~/Documents/The Vault/N.md"'],
  ];

  test.each(denied)("denies %s", (_, tool, command) => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = guard(sandbox, tool, { command });

    // #then
    expect(result).toEqual(blocked(tool, MENTION));
  });

  test("denies any other command run from inside the Vault, naming the folder", () => {
    // #given
    const sandbox = makeSandbox();
    const inbox = join(sandbox.vault, "Inbox");
    mkdirSync(inbox);

    // #when
    const result = guard(sandbox, "Bash", { command: "ls -la" }, inbox);

    // #then
    expect(result).toEqual(blocked("Bash", inbox));
  });

  const allowed: [string, string, boolean][] = [
    ["a brain-dump call run from inside the Vault", "brain-dump recall todo", true],
    ["a brain-dump call naming the Vault", `brain-dump show "The Vault/N.md"`, false],
    ["a brain-dump call with separators inside quotes", "brain-dump recall 'a;b|c' \"The Vault && more > less\"", false],
    ["a brain-dump call with a quoted heredoc", "brain-dump write-dump --tool ClaudeCode --slug s <<'EOF'\n## Learnings\n- The Vault; $(x) | `y` > z\nEOF", true],
    ["a brain-dump call with a <<- double-quoted heredoc", 'brain-dump apply <<-"EOF"\n{"note": "The Vault"}\n\tEOF\n', false],
    ["a command that doesn't touch the Vault", "ls && cat notes.md | grep vault > out.txt", false],
    ["a command that says \"the vault\" in prose", 'git commit -m "feat: the vault guard" && git push', false],
  ];

  test.each(allowed)("allows %s", (_, command, fromVault) => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = guard(sandbox, "Bash", { command }, fromVault ? sandbox.vault : sandbox.home);

    // #then
    expect(result).toEqual(ALLOWED);
  });
});

describe("guard on Codex apply_patch", () => {
  const patch = (...lines: string[]) => ["*** Begin Patch", ...lines, "*** End Patch"].join("\n");

  const denied: [string, (sandbox: Sandbox) => { command: string; cwd?: string; target: string }][] = [
    ["an Add File into the Vault", ({ vault }) => ({ command: patch(`*** Add File: ${join(vault, "N.md")}`, "+x"), target: join(vault, "N.md") })],
    ["a Delete File in the Vault", ({ vault }) => ({ command: patch(`*** Delete File: ${join(vault, "N.md")}`), target: join(vault, "N.md") })],
    ["an Update File in the Vault", ({ vault }) => ({ command: patch(`*** Update File: ${join(vault, "N.md")}`, "@@", "-a", "+b"), target: join(vault, "N.md") })],
    [
      "a Move to into the Vault",
      ({ home, vault }) => ({ command: patch(`*** Update File: ${join(home, "x.md")}`, `*** Move to: ${join(vault, "x.md")}`, "@@", "-a", "+b"), target: join(vault, "x.md") }),
    ],
    ["a marker line with surrounding whitespace", ({ vault }) => ({ command: patch(`  *** Add File: ${join(vault, "N.md")}  `, "+x"), target: join(vault, "N.md") })],
    ["a path relative to cwd", ({ home, vault }) => ({ command: patch("*** Add File: Documents/The Vault/N.md", "+x"), cwd: home, target: join(vault, "N.md") })],
    [
      "a relative path through a symlink to the Vault",
      ({ home }) => {
        symlinkSync(join(home, "Documents", "The Vault"), join(home, "notes"));
        return { command: patch("*** Add File: notes/N.md", "+x"), cwd: home, target: join(home, "notes", "N.md") };
      },
    ],
  ];

  test.each(denied)("denies %s", (_, setup) => {
    // #given
    const sandbox = makeSandbox();
    const { command, cwd, target } = setup(sandbox);

    // #when
    const result = guard(sandbox, "apply_patch", { command }, cwd);

    // #then
    expect(result).toEqual(blocked("apply_patch", target));
  });

  test("denies a patch sent as a Bash heredoc", () => {
    // #given
    const sandbox = makeSandbox();
    symlinkSync(sandbox.vault, join(sandbox.home, "notes"));
    const command = `apply_patch <<'EOF'\n${patch("*** Update File: notes/N.md", "@@", "-a", "+b")}\nEOF`;

    // #when
    const result = guard(sandbox, "Bash", { command });

    // #then
    expect(result).toEqual(blocked("Bash", join(sandbox.home, "notes", "N.md")));
  });

  test("denies a Bash heredoc patch whose paths are relative to a leading cd", () => {
    // #given
    const sandbox = makeSandbox();
    symlinkSync(sandbox.vault, join(sandbox.home, "notes"));
    const command = `cd notes && apply_patch <<'EOF'\n${patch("*** Add File: N.md", "+x")}\nEOF`;

    // #when
    const result = guard(sandbox, "Bash", { command });

    // #then
    expect(result).toEqual(blocked("Bash", join(sandbox.home, "notes", "N.md")));
  });

  test("allows a patch outside the Vault", () => {
    // #given
    const sandbox = makeSandbox();
    const command = patch("*** Add File: Projects/x.ts", "+x", `*** Update File: ${join(sandbox.home, "y.ts")}`, "@@", "-a", "+b");

    // #when
    const result = guard(sandbox, "apply_patch", { command });

    // #then
    expect(result).toEqual(ALLOWED);
  });
});

describe("guard stands down", () => {
  test("allows everything when the project was opened inside the Vault", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = guard(sandbox, "Edit", { file_path: join(sandbox.vault, "N.md") }, sandbox.vault, { CLAUDE_PROJECT_DIR: join(sandbox.vault, "Research") });

    // #then
    expect(result).toEqual(ALLOWED);
  });
});

describe("guard on input it can't read", () => {
  test("denies when the input mentions the Vault", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = guardRaw(sandbox, '{"tool_input": {"file_path": "~/Documents/The Vault/N.md"}}');

    // #then
    expect(result).toEqual(blocked("unknown tool", "Vault mention in hook input (guard error: hook input has no tool_name)"));
  });

  test("allows when the input doesn't mention the Vault", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = guardRaw(sandbox, '{"tool_name": "Read", "tool_input": {"file_path": "/tmp/x"');

    // #then
    expect(result).toEqual(ALLOWED);
  });
});
