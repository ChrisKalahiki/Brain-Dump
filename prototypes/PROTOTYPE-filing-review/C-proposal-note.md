# C: a proposal note reviewed in Obsidian

`/file` writes nothing to any target. It creates
`Inbox/2026-10-05 1940 Brain-Dump - wayfinder charting (Filing proposal).md`:

```markdown
---
tags:
  - dump
  - FilingProposal
---
Proposal for [[2026-10-05 1940 Brain-Dump - wayfinder charting]]. Untick anything you don't want; edit a [[target]] to redirect it. Then run `/file apply`.

## New notes
- [x] [[Agent Skills]] in `Research/Main Notes/` (tags: LLMs, VibeCoding)
- [x] [[Obsidian Vault Setup]] in `Side Projects/Obsidian/` (tags: SideProject)
- [x] [[Brain-Dump]] in `Side Projects/Brain-Dump/` (tags: SideProject, project)

## Appends
- [x] 1 Learning → [[Agent Skills]]
	- Codex removed custom prompts in 0.118; …
- [x] 2 Learning → [[Agent Skills]]
	- Claude web share links can't be fetched; …
- [x] 3 Learning → [[Obsidian Vault Setup]]
	- The core Daily Notes plugin …
- [x] 4 Decision → [[Brain-Dump]]
	- Brain-Dump is agent-native commands… / Why: …
- [x] 5 Decision → [[Brain-Dump]]
	- Filing is append-only in v1. / Why: …
- [x] 6 Todo → [[10-05-26 Weekly Update]] `# To-Do:`
- [x] 7 Todo → [[10-05-26 Weekly Update]] `# To-Do:`
- [x] Link line → [[10-05-26 Weekly Update]] `# Notes:`
```

In Obsidian you untick 3, change `[[Obsidian Vault Setup]]` to `[[Zotero Plug-in for Obsidian]]`, and remove its New notes line. Then, back in a terminal:

```text
> /file apply
Read proposal: 7 appends, 2 new notes (1 unticked).
Filed 6/7 Items. Item 3 stays unfiled in the Dump.
Proposal note deleted.
```
