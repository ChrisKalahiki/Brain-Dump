import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHAT_DUMP_PATH, chatDumpPrompt, ITEM_RULES_PATH } from "../src/prompts.ts";

const ROOT = join(import.meta.dir, "..");

describe("the shared Item rules", () => {
  test("prompts/chat-dump.md is the prompt built from them, so the paste text can't drift", () => {
    // #given
    const committed = readFileSync(CHAT_DUMP_PATH, "utf8");

    // #when
    const built = chatDumpPrompt();

    // #then
    expect(committed).toBe(built);
  });

  test("the chat prompt holds the fragment word for word", () => {
    // #given
    const fragment = readFileSync(ITEM_RULES_PATH, "utf8");

    // #when
    const built = chatDumpPrompt();

    // #then
    expect(built).toContain(fragment);
  });

  test("the dump skill reads the fragment", () => {
    // #given
    const skill = readFileSync(join(ROOT, "skills", "dump", "SKILL.md"), "utf8");

    // #when
    const reads = skill.includes("`item-rules.md`");

    // #then
    expect(reads).toBe(true);
  });
});
