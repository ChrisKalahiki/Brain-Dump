---
name: dump
description: Save this Session's Learnings, Decisions and Todos as one Dump in the Vault's Inbox.
disable-model-invocation: true
allowed-tools: Bash(brain-dump:*)
---

Turn this Session into one **Dump**: the Items worth keeping a month from now, written into the Obsidian Vault's Inbox by the `brain-dump` helper. Vocabulary (Dump, Item, Learning, Decision, Rationale, Todo, Session) follows the Brain-Dump glossary.

**Chat Session**: when the user runs `dump --paste` with a chat app's output, or gives a chat URL or "the open tab", the Session is a chat in Claude web, ChatGPT or Gemini. Read `chat.md` in this skill's folder and follow it instead of steps 1–2.

## 1. Pick the Items

Read `item-rules.md` in this skill's folder: the Item rules every Dump follows, shared with the chat prompt and the Sweep. Apply them to this Session.

Done when every Item passes the month-from-now test and the focus, if any, is honoured.

## 2. Write the body

Write the body and slug exactly as `item-rules.md` shows.

## 3. Write the Dump

Run the helper from the Session's working directory, passing the tool tag: the tool you are running in (`ClaudeCode` or `Codex`), or for a chat Session the tag `chat.md` names. In Codex, the helper writes outside the workspace, so run it with escalated permissions from the first attempt: the user approves the write once per Dump.

```bash
brain-dump write-dump --tool <ClaudeCode|Codex> --slug "<slug>" <<'DUMP'
<body>
DUMP
```

The helper records this Session's id (from `CLAUDE_CODE_SESSION_ID` or `CODEX_THREAD_ID`) so a later Sweep knows it is captured. When the user gave a focus, add `--session ""`: the Dump then covers only part of the Session, and the Sweep should still draft the rest.

- **Exit 0**: it prints the Dump's path. Tell the user the path and how many Items it holds.
- **`invalid Dump body: …`**: the message names the broken rule. Fix the body to match step 2 and run the command again.
- **`Dump refused: line N looks like it holds …`**: nothing was written. Rewrite that Item without the secret (say where it lives instead), tell the user what you removed, and run the command again.
- **Escalation declined in Codex**: run the same command once more without escalation. The sandbox stops the write, so it lands in the next branch with the complete Dump printed.
- **Any other failure** (Vault not found, not an Obsidian Vault, write denied): the helper prints the reason on stderr and the complete Dump on stdout. Tell the user the reason, then show that complete Dump in a fenced `markdown` block so nothing is lost. The helper is the only writer; the Dump stays in the Session until the user retries.

Done when the user has either the written path or the complete Dump in front of them.
