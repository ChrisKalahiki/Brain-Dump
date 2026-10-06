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

Read the chat through Claude in Chrome, in a tab you open for it. If Claude in Chrome isn't available, ask the user to use `--paste` instead.

**claude.ai**: the page shows only a window of messages, and clicking "Load earlier messages" repeatedly can freeze it. Read the transcript from the page's own conversation data instead, with the JavaScript tool in the chat's tab (same-origin, the user's own logged-in Session):

```js
const id = location.pathname.split('/').pop();
const orgs = await fetch('/api/organizations').then(r => r.json());
let convo;
for (const o of orgs) {
  const r = await fetch(`/api/organizations/${o.uuid}/chat_conversations/${id}?tree=True&rendering_mode=messages&render_all_tools=false`);
  if (r.ok) { convo = await r.json(); break; }
}
window.__transcript = convo.chat_messages
  .map((m, i) => `[${i} ${m.sender}]\n${m.content.filter(c => c.type === 'text').map(c => c.text).join('\n')}`)
  .join('\n\n');
({ messages: convo.chat_messages.length, chars: window.__transcript.length })
```

The JavaScript tool truncates long results, so read the transcript through the page text instead: replace the tab's body with one slice at a time (`document.body.innerHTML = ''`, then a `<main><pre>` holding `window.__transcript.slice(start, start + 15000)`), read it with the page-text tool, and repeat until the end. Close the tab when done. If the request fails (the endpoint is undocumented and may change), fall back to reading the page as below.

**ChatGPT, Gemini, or the fallback**: read the page text, loading earlier messages until the first one is on the page.

Then pick the Items and write the body and slug exactly as `SKILL.md` steps 1–2 describe, treating the chat as the Session.

Done when the body covers the chat from its first message to its last. If the start of the chat can't be read, say so to the user and suggest `--paste` for this one.

## Options for step 3

```bash
brain-dump write-dump --tool <ClaudeWeb|ChatGPT|Gemini> --slug "<slug>" [--chat-url "<url>"] [--project "<project>"] <<'DUMP'
<body>
DUMP
```

- `--chat-url`: the chat's URL, when known.
- `--project`: only when the user names a project for this chat.
