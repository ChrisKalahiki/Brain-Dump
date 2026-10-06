---
name: dump
description: Capture this Session's Learnings, Decisions and Todos as one Dump in the Vault's Inbox.
disable-model-invocation: true
allowed-tools: Bash(brain-dump:*)
---

Turn this Session into one **Dump**: the Items worth keeping a month from now, written into the Obsidian Vault's Inbox by the `brain-dump` helper. Vocabulary (Dump, Item, Learning, Decision, Rationale, Todo, Session) follows the Brain-Dump glossary.

## 1. Pick the Items

Read back over the Session and keep what would be lost otherwise:

- **Learning**: something found out (a fact, a gotcha, how a tool behaves). Keep URLs that came up inline in the Item.
- **Decision**: a choice that was made, with its **Rationale** (why this over the alternatives).
- **Todo**: an action still to be taken.

If the user gave a focus with the command (e.g. "just the auth decisions"), keep only Items inside that focus.

Each Item is one self-contained sentence or two: readable cold, without the Session. Leave out play-by-play, dead ends that taught nothing, and anything already captured in code or commit messages.

Done when every Item passes the month-from-now test and the focus, if any, is honoured.

## 2. Write the body

Exactly this shape, sections in this order, a section left out entirely when it has no Items:

```markdown
## Learnings
- [ ] <Learning>

## Decisions
- [ ] <Decision>
	- Why: <Rationale>

## Todos
- [ ] #todo <Todo>
```

Every Decision carries its tab-indented `- Why:` line; every Todo carries `#todo`. Nothing else goes in the body: no title, no frontmatter, no origin line (the helper adds those).

Also write a **slug**: a 2–6 word title for the Dump, e.g. `wayfinder charting` or `auth token refresh`.

## 3. Write the Dump

Run the helper from the Session's working directory, passing the tool you are running in (`ClaudeCode` or `Codex`). In Codex, the helper writes outside the workspace, so run it with escalated permissions from the first attempt: the user approves the write once per Dump.

```bash
brain-dump write-dump --tool <ClaudeCode|Codex> --slug "<slug>" <<'DUMP'
<body>
DUMP
```

- **Exit 0**: it prints the Dump's path. Tell the user the path and how many Items it holds.
- **`invalid Dump body: …`**: the message names the broken rule. Fix the body to match step 2 and run the command again.
- **Escalation declined in Codex**: run the same command once more without escalation. The sandbox stops the write, so it lands in the next branch with the complete Dump printed.
- **Any other failure** (Vault not found, not an Obsidian Vault, write denied): the helper prints the reason on stderr and the complete Dump on stdout. Tell the user the reason, then show that complete Dump in a fenced `markdown` block so nothing is lost. The helper is the only writer; the Dump stays in the Session until the user retries.

Done when the user has either the written path or the complete Dump in front of them.
