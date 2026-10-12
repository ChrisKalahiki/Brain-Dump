import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeSandbox, originLine, run, writeDumpArgs } from "./harness.ts";

const BODY = "## Learnings\n- [ ] Codex reads skills from ~/.agents/skills.\n";
const SESSION = "94b88df4-6e39-4f47-a5c5-724fef94a2c1";

function frontmatter(path: string): string {
  const contents = readFileSync(path, "utf8");
  return contents.slice(0, contents.indexOf("\n---\n", 4) + 5);
}

function inboxFiles(vault: string): string[] {
  const inbox = join(vault, "Inbox");
  return existsSync(inbox) ? readdirSync(inbox) : [];
}

describe("write-dump records the Session a Dump covers", () => {
  test("writes session and through, through defaulting to the Dump's time", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = run(sandbox, [...writeDumpArgs("s"), "--session", SESSION], { stdin: BODY });

    // #then
    expect(frontmatter(result.stdout.trim())).toBe(
      `---\ntags:\n  - dump\n  - AIGenerated\n  - ClaudeCode\nsession: ${SESSION}\nthrough: ${new Date("2026-10-05T19:40").toISOString()}\n---\n`,
    );
  });

  test("writes the through it is given", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = run(sandbox, [...writeDumpArgs("s"), "--session", SESSION, "--through", "2026-10-05T18:02:11.500Z"], { stdin: BODY });

    // #then
    expect(frontmatter(result.stdout.trim())).toContain(`session: ${SESSION}\nthrough: 2026-10-05T18:02:11.500Z\n---`);
  });

  test("leaves both out when the session id is empty, as an unset variable passes it", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = run(sandbox, [...writeDumpArgs("s"), "--session", ""], { stdin: BODY });

    // #then
    expect(frontmatter(result.stdout.trim())).toBe("---\ntags:\n  - dump\n  - AIGenerated\n  - ClaudeCode\n---\n");
  });

  const usageErrors: [string, string[], string][] = [
    ["--through without --session", ["--through", "2026-10-05T18:00:00Z"], "--through needs --session"],
    ["a through that isn't a time", ["--session", SESSION, "--through", "later"], `--through "later" is not a date and time`],
    ["a session id YAML would mangle", ["--session", "a: b"], `--session "a: b" may hold only letters, digits, ".", "_" and "-"`],
  ];

  for (const [name, args, reason] of usageErrors) {
    test(`rejects ${name}`, () => {
      // #given
      const sandbox = makeSandbox();

      // #when
      const result = run(sandbox, [...writeDumpArgs("s"), ...args], { stdin: BODY });

      // #then
      expect({ exitCode: result.exitCode, stderr: result.stderr, written: inboxFiles(sandbox.vault) }).toEqual({ exitCode: 2, stderr: `brain-dump: ${reason}\n`, written: [] });
    });
  }
});

describe("write-dump writes a swept Dump", () => {
  test("tags it dump/swept and marks its origin line", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = run(sandbox, [...writeDumpArgs("s", "Codex"), "--swept", "--session", SESSION], { stdin: BODY });

    // #then
    const path = result.stdout.trim();
    expect({ tags: frontmatter(path).split("\n").slice(1, 6), origin: originLine(path)?.startsWith("Session: Codex (swept) · `") }).toEqual({
      tags: ["tags:", "  - dump", "  - dump/swept", "  - AIGenerated", "  - Codex"],
      origin: true,
    });
  });

  const usageErrors: [string, string[], string][] = [
    ["without a session", ["--swept"], "--swept needs --session"],
    ["for a chat tool", ["--swept", "--session", SESSION, "--tool", "ChatGPT"], "--swept is only for ClaudeCode and Codex"],
  ];

  for (const [name, args, reason] of usageErrors) {
    test(`rejects a swept Dump ${name}`, () => {
      // #given
      const sandbox = makeSandbox();

      // #when
      const result = run(sandbox, [...writeDumpArgs("s"), ...args], { stdin: BODY });

      // #then
      expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 2, stderr: `brain-dump: ${reason}\n` });
    });
  }
});

describe("write-dump refuses a body that looks like it holds a secret", () => {
  const secrets: [string, string][] = [
    ["an OpenAI or Anthropic key", "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz012345"],
    ["a GitHub token", "ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"],
    ["a fine-grained GitHub token", "github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz"],
    ["an AWS access key id", "AKIAIOSFODNN7EXAMPLE"],
    ["an AWS secret key", "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"],
    ["a PEM header", "-----BEGIN OPENSSH PRIVATE KEY-----"],
    ["a password assignment", "PASSWORD=hunter2"],
  ];

  for (const [name, secret] of secrets) {
    test(`refuses ${name}, writing nothing and not echoing it`, () => {
      // #given
      const sandbox = makeSandbox();
      const body = `## Learnings\n- [ ] Codex reads skills.\n- [ ] The key is ${secret} for now.\n`;

      // #when
      const result = run(sandbox, writeDumpArgs("s"), { stdin: body });

      // #then
      expect({ exitCode: result.exitCode, stdout: result.stdout, leaked: result.stderr.includes(secret), stderr: result.stderr.split(":")[1], written: inboxFiles(sandbox.vault) }).toEqual({
        exitCode: 1,
        stdout: "",
        leaked: false,
        stderr: " Dump refused",
        written: [],
      });
    });
  }

  test("names the line and the kind of secret", () => {
    // #given
    const sandbox = makeSandbox();
    const body = "## Learnings\n- [ ] Codex reads skills.\n- [ ] Token ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789 works.\n";

    // #when
    const result = run(sandbox, writeDumpArgs("s"), { stdin: body });

    // #then
    expect(result.stderr).toBe("brain-dump: Dump refused: line 3 looks like it holds a GitHub token; remove it and write the Dump again\n");
  });

  test("lets ordinary prose about secrets through", () => {
    // #given
    const sandbox = makeSandbox();
    const body = "## Learnings\n- [ ] Store the password in 1Password, never in a skill-sk file or ghp_ prefix docs.\n";

    // #when
    const result = run(sandbox, writeDumpArgs("s"), { stdin: body });

    // #then
    expect(result.exitCode).toBe(0);
  });
});
