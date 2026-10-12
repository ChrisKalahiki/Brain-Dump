# Brain-Dump
This is a tool to help me dump my work into my Obsidian Vault more efficiently.

## Capturing a chat

`dump --paste` is the way to capture a chat from Claude web, ChatGPT or Gemini, however long it is:

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

## Prompt evals

A change to a prompt is scored before it ships: `bun run eval [name]` runs each eval's committed synthetic fixtures on the pinned model, three runs each (`--runs N` to change), and needs every run to pass its deterministic checks; a pass with fewer than three runs is not recorded. A rubric grade from the same model is printed beside the result but never gates. A passing run records the eval's input hash in `evals/passed.json`; `bun test` fails while any eval's prompts, shared rules, fixtures, checks or model have changed since. The `sweep` eval runs the Sweep's own drafting step on `evals/fixtures/sweep`.
