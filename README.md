# Brain-Dump
This is a tool to help me dump my work into my Obsidian Vault more efficiently.

## Vault guard

`install.sh` offers `brain-dump guard`, a PreToolUse hook that stops agents reaching the Vault except through `brain-dump`, in Claude Code (`~/.claude/settings.json`) and Codex (`~/.codex/hooks.json`). Codex skips the hook until you trust it once in `/hooks`.

The Codex guard is best effort. It reads `apply_patch` patches and Bash commands, but Codex hides a shell call's `workdir` from the hook, and commands typed into a running shell through `write_stdin` are never hooked, so either can reach the Vault unseen.
