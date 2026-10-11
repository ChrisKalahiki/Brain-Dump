---
name: recall
description: 'Look up what the Vault already holds about this project or a subject: past Decisions with their Rationale, Learnings, open Todos, and the Session each came from. Use when starting work on a project, before re-deciding something that may already have been decided, or when the user refers to earlier work ("what did we decide about…", "last time we…"). Not for anything that is in the repo itself.'
allowed-tools: Bash(brain-dump:*)
---

Answer from the Obsidian Vault through the `brain-dump` helper only. Never read the Vault with your own file tools: the Vault guard blocks them, and the helper keeps to the folders models may see. Vocabulary (Vault, Dump, Item, Learning, Decision, Rationale, Todo, Session, Digest) follows the Brain-Dump glossary.

## Look up Items

Run exactly one of these per call. Each prints JSON.

- `brain-dump recall --project` — this repo's Items, newest first. Add a name (`--project chronos`) for another project.
- `brain-dump recall <terms…>` — Items matching any term, case-insensitive, ranked by how many of the terms each matches, then recency. Use a few distinctive words, not a sentence.
- `brain-dump recall --links "[[Note]]"` — every line that links to a note, as `{"links": [{"note", "line"}]}`.

Item results come as `{"results": [...], "more": N}`, at most 20 at a time. Each result has:

- `note`: where the Item lives now. For an `unfiled` Item it is the Dump itself, still in the Inbox and not yet settled.
- `kind`: `decision` (with its Rationale in `why`), `learning` or `todo`. A filed Todo's `text` keeps its checkbox: `[ ]` open, `[x]` done.
- `dump` and `origin`: the Dump it came from and that Dump's Session line (tool, repo, branch, time). Both are `null` when the helper can't trace the Item to one Dump: it was written by hand, or it is a Todo reworded when filed or filed with the same text from several Dumps.

When `more` is above 0, narrow the terms rather than paging.

## Read a note

`brain-dump show <note>` takes a path from a result, a title, or `"[[Title]]"`. It prints `{"note", "hash", "text", "truncated"}`. `text` starts at the note's latest Digest, which summarises everything before it, so that is usually all you need. Add `--full` only when the Digest leaves out something you need. Text is capped at 60,000 characters (`truncated: true`) except with `--full`.

## Answering

- Lead with what the Vault says, citing each Item's `note`, and its `dump` when the Session matters.
- Say plainly when a Decision is still `unfiled`, and when nothing was found. Don't fill gaps from memory.
- A past Decision is context, not a rule: if the current work contradicts it, point that out and let the user decide.
