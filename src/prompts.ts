import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The Item rules live once, in the dump skill's folder so the installed skill can read them; every other prompt is built from them.

const ROOT = join(import.meta.dir, "..");
export const ITEM_RULES_PATH = join(ROOT, "skills", "dump", "item-rules.md");
const CHAT_DUMP_PATH = join(ROOT, "prompts", "chat-dump.md");

const CHAT_INTRO = `<!-- Built from skills/dump/item-rules.md by \`bun run prompts\`; edit that file, not this one. -->
When I say **"dump"**, turn this conversation into a Dump: the things worth keeping a month from now, for my notes. Follow these rules.

`;

const CHAT_REPLY = `
## Reply

Reply with exactly two things and nothing else:

1. A line \`Slug: <slug>\`.
2. One fenced \`markdown\` code block holding the body.
`;

/** The text a chat app is given once, whose reply \`dump --paste\` takes. */
export function chatDumpPrompt(): string {
  return `${CHAT_INTRO}${readFileSync(ITEM_RULES_PATH, "utf8")}${CHAT_REPLY}`;
}

if (import.meta.main) writeFileSync(CHAT_DUMP_PATH, chatDumpPrompt());
