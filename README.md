# Brain-Dump
This is a tool to help me dump my work into my Obsidian Vault more efficiently.

## Dumping a chat

`dump --paste` is the way to dump a Session from Claude web, ChatGPT or Gemini, however long it is:

1. Paste `prompts/chat-dump.md` into the chat app once: a Claude Project's instructions, or the chat itself in ChatGPT or Gemini.
2. Say "dump" in the chat. It replies with a `Slug:` line and the Dump body.
3. In Claude Code or Codex, run `/dump --paste` and paste that reply.

`/dump <chat URL>` reads the chat through Claude in Chrome instead (Claude Code only). It is a convenience for short chats and falls back to `--paste` when it can't reach the start of the chat.

`prompts/chat-dump.md` is built from the Item rules in `skills/dump/item-rules.md`, which `dump` and the Sweep share. Edit the rules there, then run `bun run prompts`; a test fails while the two disagree.

## Vault guard

`install.sh` offers `brain-dump guard`, a PreToolUse hook that stops agents reaching the Vault except through `brain-dump`, in Claude Code (`~/.claude/settings.json`) and Codex (`~/.codex/hooks.json`). Codex skips the hook until you trust it once in `/hooks`.

The Codex guard is best effort. It reads `apply_patch` patches and Bash commands, but Codex hides a shell call's `workdir` from the hook, and commands typed into a running shell through `write_stdin` are never hooked, so either can reach the Vault unseen.

## Vault pointer

`install.sh` also offers `brain-dump pointer`, a SessionStart hook in the same two files. When a Session starts it names up to three Vault notes for the repo (its Route target, then the notes holding the most Items from its Dumps) with its unfiled-Dump count, and the number of `brain-dump check` findings. It prints nothing when there is nothing to say, and skips whatever doesn't fit in about a second.

## Sweep

`brain-dump sweep` drafts a Dump from each recent Claude Code or Codex Session you never dumped, so nothing is lost when Claude Code deletes its logs after 30 days. It reads Codex rollouts from `~/.codex/sessions` (or `$CODEX_HOME/sessions`), including compressed `.jsonl.zst` ones, and leaves out sub-agent Sessions. Each Session is drafted by its own `claude -p` run with no tools and no saved transcript, and the Dumps land only in the Inbox, tagged `dump/swept`, for normal Filing. It prints a summary of what it wrote, skipped, couldn't read and carried over; `brain-dump sweep --last` prints it again, and `brain-dump undo <run>` removes everything one Sweep wrote.

`install.sh` offers to run the Sweep daily at 04:00 on each machine: a launchd agent on macOS, a systemd user timer on Linux. A missed day is caught up by the next Sweep, which reads every Session since the last one. It prints how to turn it off. For a day after a Sweep that wrote Dumps or hit a problem, the Vault pointer adds a line saying so, and `file` shows the last Sweep's summary when it starts.

It leaves out Sessions in the Vault, still active in the last 2 hours, with fewer than 3 user messages, or already covered by a Dump. To keep a repo out, list it in `~/.config/brain-dump/config`:

```
sweep-opt-out = ~/Projects/client-work, ~/Projects/secret
```

## Checks

`bun run check` runs the typecheck, the Glossary check, then the full test suite. The Glossary check (`bun run glossary`) fails on any `_Avoid_:` term from `GLOSSARY.md` in the skills, prompts, README, current spec, or string literals in `src/`; terms with a common other sense, and the superseded v1 and v2 specs, are listed as unchecked in `scripts/glossary.ts`. `bun install` points git at `.githooks`, whose pre-commit hook runs it on every commit. CI runs `check` and `bun run eval:check` (see below) on every push and PR.

## Prompt evals

A change to a prompt is scored before it ships: `bun run eval [name]` runs each eval's committed synthetic fixtures on the pinned model, three runs each (`--runs N` to change), and needs every run to pass its deterministic checks; a pass with fewer than three runs is not recorded. A rubric grade from the same model is printed beside the result but never gates. A passing run records the eval's input hash in `evals/passed.json`; `bun run eval:check` fails while any eval's prompts, shared rules, fixtures or model have changed since, or any module its entry points reach through imports. The evals:

- `sweep`: the Sweep's own drafting step on `evals/fixtures/sweep`.
- `dump`: `/dump` at the end of a synthetic Session (`evals/fixtures/dump`), with and without a focus, writing through the helper into a sandbox Vault.
- `chat-dump`: `prompts/chat-dump.md` as a chat's instructions, then "dump", on synthetic chats (`evals/fixtures/chat-dump`); the reply is read as `dump --paste` reads it.
- `file`: `/file` with only `Bash(brain-dump:*)` on a fixture Vault (`evals/fixtures/file`), one Dump per case: a Routine plan, a NEW note, a NEW Todo Group, a `≈` match, and a link line to a NEW Weekly Note. No reply is sent; each Item's destination and marks are read from the plan, and any change to the Vault fails the run.
- `todo`: `/todo` with what the user says, on a fixture Vault with this week's and last week's Weekly Notes (`evals/fixtures/todo`): one matching Todo, two equally matching ones, a parent with open sub-todos, and a Todo open only in last week's note. No reply is sent; the Todos proposed, offered and listed as candidates are read from the reply, and any change to the Vault fails the run.

`dump`, `chat-dump`, `file` and `todo` run Claude Code headless with only the repo's skills (`--setting-sources project`). `dump` and `chat-dump` resume their synthetic Session from a log written to `~/.claude/projects` and removed after the run.

### Hand checks

These have no automated eval; check them by hand when their prompts change:

- **`consolidate`**: run `/consolidate [[Note]]` on a long Topic Note. The Digest it proposes should cover the note's Items without inventing any, and nothing is written until you approve its full text.
- **`recall` triggering**: in a repo whose project the Vault knows, ask "what did we decide about …?" and start a task that touches an earlier Decision. `recall` should run on its own both times, and not for questions the repo itself answers.
- **`todo` triggering**: with an open Todo in this week's Weekly Note, ask "what's on my plate this week?", then say in passing that you finished that Todo. `todo` should run on its own both times, and the second time propose marking it without marking anything.
- **`chat-dump` in ChatGPT and Gemini**: paste `prompts/chat-dump.md` into each, hold a short chat, say "dump", and run `/dump --paste` on the reply. It should be a `Slug:` line and one `markdown` block that `write-dump` takes without a fix.
