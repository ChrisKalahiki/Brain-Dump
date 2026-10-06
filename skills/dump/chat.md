# Dumping a chat Session

The chat-app branch of `dump`: the Session lives in Claude web, ChatGPT or Gemini, not here. It replaces steps 1–2 of `SKILL.md`; step 3 is the same except for the options below.

## Tool tag

`ClaudeWeb`, `ChatGPT` or `Gemini`: whichever app the chat came from. Infer it from the URL or the user's words; ask when neither says.

## `--paste`: the user pasted the chat app's output

The chat app was given the saved chat prompt, so the paste holds a `Slug:` line and a fenced `markdown` block with the body.

- Body: the contents of that block, unchanged. If the helper rejects it as `invalid Dump body`, fix only the formatting rule it names (indentation, a missing `#todo`, a stray line) and tell the user what you adjusted; the wording of every Item stays as the chat app wrote it.
- Slug: from the `Slug:` line; write one (2–6 words) if it is missing.

Done when you hold the body exactly as pasted and a slug.

## A chat URL or "the open tab" (Claude Code only)

Read the chat through Claude in Chrome: open the URL (or use the open tab) and read the whole Session, scrolling to its first message. If Claude in Chrome isn't available, ask the user to use `--paste` instead.

Then pick the Items and write the body and slug exactly as `SKILL.md` steps 1–2 describe, treating the chat as the Session.

Done when the body covers the chat from its first message to its last. If the page would not show the start of the chat, say so to the user and suggest `--paste` for this one.

## Options for step 3

```bash
brain-dump write-dump --tool <ClaudeWeb|ChatGPT|Gemini> --slug "<slug>" [--chat-url "<url>"] [--project "<project>"] <<'DUMP'
<body>
DUMP
```

- `--chat-url`: the chat's URL, when known.
- `--project`: only when the user names a project for this chat.
