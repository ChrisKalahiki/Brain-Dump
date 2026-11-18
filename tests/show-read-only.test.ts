import { expect, test } from "bun:test";
import { mkdirSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { checkWrites } from "../src/gateway.ts";
import { makeSandbox, readVaultFile, run, writeVaultFile } from "./harness.ts";

const REVIEW = "Research/Learning to Vibe Code/Literature Review.md";

test("show reads only the approved literature review without making it writable or discoverable", () => {
  const sandbox = makeSandbox();
  const contents = "# Review\nVerification and learning transfer.\n";
  const path = writeVaultFile(sandbox, REVIEW, contents);
  const result = run(sandbox, ["show", REVIEW, "--full"]);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ note: REVIEW, text: contents, truncated: false });
  expect(() => checkWrites({ root: sandbox.vault, inbox: join(sandbox.vault, "Inbox") }, "approved-plan", [{ mode: "append", path, contents: "changed" }])).toThrow("outside the write allowlist");
  expect(run(sandbox, ["list-notes"]).stdout).not.toContain(REVIEW);
  expect(run(sandbox, ["recall", "Verification"]).stdout).not.toContain(REVIEW);
  expect(run(sandbox, ["consolidate", REVIEW], { stdin: JSON.stringify({ expect: {}, bullets: ["One", "Two", "Three"] }) }).exitCode).toBe(1);
  expect(readVaultFile(sandbox, REVIEW)).toBe(contents);
});

test("show still refuses neighboring and similarly named literature-review notes", () => {
  const sandbox = makeSandbox();
  writeVaultFile(sandbox, REVIEW, "approved");
  for (const note of ["Research/Learning to Vibe Code/Private.md", "Research/Other/Literature Review.md"]) {
    writeVaultFile(sandbox, note, "not approved");
    expect(run(sandbox, ["show", note, "--full"]).exitCode).toBe(1);
  }
});

test("show refuses an approved pathname replaced by a symlink to another file", () => {
  const sandbox = makeSandbox();
  const secret = writeVaultFile(sandbox, "Private/Journal.md", "private");
  const path = join(sandbox.vault, REVIEW);
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(secret, path);
  const result = run(sandbox, ["show", REVIEW, "--full"]);
  expect(result.exitCode).toBe(1);
  expect(result.stdout).not.toContain("private");
});

test("show refuses an approved pathname reached through a symlinked parent folder", () => {
  const sandbox = makeSandbox();
  const secret = writeVaultFile(sandbox, "Private/Literature Review.md", "private");
  mkdirSync(join(sandbox.vault, "Research"), { recursive: true });
  symlinkSync(dirname(secret), join(sandbox.vault, "Research/Learning to Vibe Code"));
  const result = run(sandbox, ["show", REVIEW, "--full"]);
  expect(result.exitCode).toBe(1);
  expect(result.stdout).not.toContain("private");
});


test("show supports the approved file's Sections and filed view, but preserves title ambiguity", () => {
  const sandbox = makeSandbox();
  writeVaultFile(sandbox, REVIEW, "# Questions\nWhat helps verification?\n");
  const section = run(sandbox, ["show", "[[Research/Learning to Vibe Code/Literature Review#Questions]]", "--full"]);
  expect(section.exitCode).toBe(0);
  expect(JSON.parse(section.stdout).text).toContain("What helps verification?");
  expect(run(sandbox, ["show", REVIEW, "--filed"]).exitCode).toBe(0);
  writeVaultFile(sandbox, "Resources/Literature Review.md", "another review");
  const ambiguous = run(sandbox, ["show", "Literature Review"]);
  expect(ambiguous.exitCode).toBe(1);
  expect(ambiguous.stderr).toContain("matches");
  expect(run(sandbox, ["show", REVIEW]).exitCode).toBe(0);
});

test("show refuses missing files, directories and dangling symlinks at the approved path", () => {
  const missing = makeSandbox();
  expect(run(missing, ["show", REVIEW]).exitCode).toBe(1);
  const directory = makeSandbox();
  mkdirSync(join(directory.vault, REVIEW), { recursive: true });
  expect(run(directory, ["show", REVIEW]).exitCode).toBe(1);
  const dangling = makeSandbox();
  mkdirSync(dirname(join(dangling.vault, REVIEW)), { recursive: true });
  symlinkSync(join(dangling.vault, "nonexistent.md"), join(dangling.vault, REVIEW));
  expect(run(dangling, ["show", REVIEW]).exitCode).toBe(1);
});
