import { describe, expect, test } from "bun:test";
import { makeSandbox, run, writeVaultFile } from "./harness.ts";

describe("brain-dump list-notes", () => {
  test("lists every note with its title, folder and frontmatter tags, skipping the Inbox and .obsidian", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, "Research/Main Notes/Context MCP/Context Bridge MCP Main Note.md", "---\ntags:\n  - MCP\n  - research\n---\n# Context Bridge\n");
    writeVaultFile(sandbox, "Side Projects/Talky/Updates for Talky.md", "No frontmatter here.\n");
    writeVaultFile(sandbox, "Inbox/2026-10-05 1940 Brain-Dump - filing.md", "---\ntags:\n  - dump\n---\n");
    writeVaultFile(sandbox, ".obsidian/workspace.md", "");

    // #when
    const result = run(sandbox, ["list-notes"]);

    // #then
    expect(JSON.parse(result.stdout)).toEqual([
      { note: "Research/Main Notes/Context MCP/Context Bridge MCP Main Note.md", title: "Context Bridge MCP Main Note", folder: "Research/Main Notes/Context MCP", tags: ["MCP", "research"] },
      { note: "Side Projects/Talky/Updates for Talky.md", title: "Updates for Talky", folder: "Side Projects/Talky", tags: [] },
    ]);
  });
});
