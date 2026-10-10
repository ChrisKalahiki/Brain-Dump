# Agents read the Vault only through the helper, within the write allowlist

v2 lets agents Recall what the Vault already holds, not just write to it. They do it only through `brain-dump` commands, taught by a `recall` skill; no agent reads the Vault with its own file tools, and the Vault never goes into Claude Code's `additionalDirectories`. This carries ADR 0002 over to the read side: one permission (`Bash(brain-dump:*)`) in Claude Code and Codex alike, and one test seam.

The helper can do what grep can't without Obsidian running: follow Routes to Project Notes, follow `From [[dump]]` backlinks to a Dump and its Session, and list what links to a note. Free-text search is a plain term match in the helper, with no index to keep in sync across machines.

Reads are limited to the same folder trees the helper may write (ADR 0004). Recall can run without being asked in any repo, and whatever it returns is sent to a model provider, so folders outside the allowlist stay out of model context by default.

## Considered Options

- **Direct reads** (add the Vault to the agent's directories and let it grep): no code, flexible search, but no backlink resolution, and in Claude Code it also makes the Vault editable under the session's permission mode, which the guard hook exists to fence.
- **Both**: two routes to every answer and both permission surfaces.
- **Read the whole Vault**: more context, but private folders would reach model providers whenever an agent recalled on its own.
