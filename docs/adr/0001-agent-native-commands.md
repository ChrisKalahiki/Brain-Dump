# Brain-Dump is agent-native commands, not a standalone CLI or Obsidian plugin

The richest material to dump lives inside AI dev Sessions. The agent running a Session already holds its context, so Brain-Dump is a set of commands/skills for Claude Code and Codex (`dump` inside a Session, `file` against the Vault) plus file conventions in the Vault. Owned machinery is kept to small helpers.

## Considered Options

- **Standalone CLI calling an LLM API**: would have to re-acquire Session context (transcript parsing) and duplicates what the agent already does.
- **Obsidian plugin**: lives in the wrong place: dumping happens in the terminal, not in Obsidian, and the Vault has no plugin-based automation today.
