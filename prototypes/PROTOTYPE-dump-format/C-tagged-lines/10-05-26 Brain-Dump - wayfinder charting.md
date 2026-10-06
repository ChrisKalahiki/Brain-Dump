---
tags:
  - dump
  - AIGenerated
  - ClaudeCode
---
Session: Claude Code · `~/Projects/Brain-Dump` · 10-05-26 19:40 · [[Brain-Dump]]

- [ ] #learning Codex removed custom prompts in 0.118; `SKILL.md` skills are the only Codex extension point, and it reads `~/.agents/skills/`, not `~/.claude/skills/`.
- [ ] #learning Claude web share links can't be fetched: the page is an empty shell and the data endpoint returns 403 behind Cloudflare.
- [ ] #learning The core Daily Notes plugin in the Vault is repurposed to create Weekly Notes (`MM-DD-YY`, `Research/Weekly Meetings`).
- [ ] #decision Brain-Dump is agent-native commands, not a CLI or an Obsidian plugin.
	- Why: the agent already holds the Session context; dumping happens in the terminal, not in Obsidian.
- [ ] #decision Filing is append-only in v1.
	- Why: protect curated notes from accidental overwrite; revisit when Filing goes automatic.
- [ ] #todo Decide the chat-app capture route (Claude web first).
- [ ] #todo Decide skill packaging: repo + `install.sh` symlinks vs plugin.
