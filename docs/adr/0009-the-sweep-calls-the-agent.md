# The Sweep is the helper calling a tool-less agent once per Session

ADR 0001 has skills call the `brain-dump` helper. The Sweep reverses that: `brain-dump sweep`, started by a daily per-machine timer, lists the Sessions to draft, extracts each one's text, and runs one fresh `claude -p --no-session-persistence` per Session with no tools. The agent only returns a Dump body and slug on stdout; the helper writes it through `write-dump`. Each Session gets a bounded context and its own failure, the drafting agent can touch nothing, and an unsaved run leaves no transcript for the next Sweep to draft.

## Considered Options

- **One `claude -p "/sweep"` skill run** that calls `brain-dump` to list, read and write: keeps skills on top as in ADR 0001, but one context grows with every Session, and drafting quality falls as it does.
- **A Claude Code cloud routine**: can't read the local Session logs.
- **A `SessionEnd` hook per Session**: avoids log retention limits, but Codex has no known equivalent, and every exit would start an agent run.
