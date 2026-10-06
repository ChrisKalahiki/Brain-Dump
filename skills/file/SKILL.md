---
name: file
description: File the Inbox's Dumps into the Vault, one approved Filing Plan per Dump.
disable-model-invocation: true
allowed-tools: Bash(brain-dump:*)
---

Work through every unfiled **Dump** in the Vault's Inbox, oldest first. For each one, show a **Filing Plan**, take the user's reply, and hand the approved plan to the `brain-dump` helper, which does every write. Vocabulary (Dump, Item, Filing, Filing Plan, Weekly Note, Topic Note, Project Note, Route) follows the Brain-Dump glossary. Filing is append-only: the helper adds lines; nothing existing is rewritten.

## 1. Load the Inbox and the Vault's map

Run these once per run:

- `brain-dump list-dumps`: each unfiled Dump's `file`, `title`, `date`, `project`, and `items` (`index`, `kind`, `text`, `rationale`, `state`). Only `open` Items are filed.
- `brain-dump list-notes`: every note's `note` (path), `title`, `folder` and `tags`.
- `brain-dump routes`: the user's **Routes**, `{key, title}` pairs mapping a project or subject to the title of the note it belongs in.

If there are no Dumps, tell the user the Inbox is clear. Done.

## 2. Find the Weekly Notes

- **This week's** (for Todos): `brain-dump weekly-note --date <today, YYYY-MM-DD>`.
- **The Session's week** (for the link line): `brain-dump weekly-note --date <the Dump's date>`.

Each prints `{"exists": …, "note": …}`. A Weekly Note that doesn't exist yet can't take lines in this version:

- This week's note missing: Todos stay open (show them as "no Weekly Note yet").
- The Session's week note missing: the whole Dump waits, every Item open, so its link line is never lost. Say so and move to the next Dump.

## 3. Route each Item

- **Todo** → this week's Weekly Note, section `# To-Do:`.
- **Learning** → the **Topic Note** it best belongs in.
- **Decision** → a Topic Note when it is really about a general subject (a tool, a technique); otherwise the **Project Note** for the Dump's project. When unsure, the Project Note.

To find a note: check the Routes first (a Route whose key matches the Dump's `project` or the Item's subject), then match titles, folders and tags from `list-notes`. Project Note titles vary ("Context Bridge MCP Main Note", "Virtual Assistant Project"), so look inside the project's folder. Route only to notes that exist; an Item with no fitting note is shown as "no note yet" and stays open (creating notes comes later).

Done when every open Item has a destination note or "no note yet".

## 4. Show the Filing Plan

One numbered table per Dump, one row per open Item, numbered by the Item's `index`:

| # | Item | → Destination | As |
|---|---|---|---|
| 1 | Learning: Codex reads ~/.agents/skills | `Agent Skills` · end | bullet + backlink |
| 2 | Decision: Filing is append-only | `Brain-Dump` · end | bullet + Why + backlink |
| 4 | Todo: Ship the file skill | `10-05-26 Weekly Update` · `# To-Do:` | `- [ ] Ship the file skill. #todo` |

What each row appends:

- **Todo**: `- [ ] <text> #todo` (the Item's text with its `#todo` moved to the end), under `# To-Do:`. No backlink.
- **Learning**: `- <text>` then `\t- From [[<title>|dump MM-DD-YY]]`, at the end of the note.
- **Decision**: `- <text>`, `\t- Why: <rationale>`, then `\t- From [[<title>|dump MM-DD-YY]]`, at the end of the note.
- **Link line** → the Session's week, section `# Notes:`, as `- Filed [[<title>|<project> <slug>]]`, where `<slug>` is the part of the title after ` - `. Add it only when this plan finishes the Dump (no Item left open) and at least one of its Items is filed, now or in an earlier run; that way each Dump gets exactly one. Show it as a row marked `+`.

Below the table, say Filing is append-only and list the replies: `ok` · `skip N` · `drop N` · `N → [[Note]]` · `show N` · `edit N` · `cancel` (combinable, e.g. `3 → [[Zotero Plug-in for Obsidian]], show 4`).

Done when the plan is on screen and nothing has been written.

## 5. Take the reply

- `skip N`: Item N stays open for a later run.
- `drop N`: Item N will never be filed (marked `[-]`); remove its row.
- `N → [[Note]]`: send Item N to that note instead (it must exist in `list-notes`). Then offer the redirect back as a Route, e.g. "Remember `<project or subject> → [[Note]]`?"; a yes adds it to this plan's `routes`.
- `show N`: print the exact lines Item N would append.
- `edit N`: ask for the new wording, then use it in Item N's lines. The Dump itself keeps its original text.
- `cancel`: write nothing, stop the whole run.
- `ok`: apply the plan as it stands.

After anything but `ok` or `cancel`, show the updated plan (the link-line rule may change) and wait again.

## 6. Apply

Build the plan as JSON and pass it on stdin:

```bash
brain-dump apply <<'PLAN'
{
  "dump": "<file>",
  "items": [
    { "index": 1, "outcome": "filed", "note": "<Topic Note path>", "lines": ["- Codex reads ~/.agents/skills.", "\t- From [[<title>|dump 10-05-26]]"] },
    { "index": 4, "outcome": "filed", "note": "<this week's note>", "section": "# To-Do:", "lines": ["- [ ] Ship the file skill. #todo"] },
    { "index": 2, "outcome": "dropped" },
    { "index": 3, "outcome": "skipped" }
  ],
  "inserts": [
    { "note": "<the Session's week note>", "section": "# Notes:", "lines": ["- Filed [[<title>|<project> <slug>]]"] }
  ],
  "routes": [{ "key": "<project or subject>", "title": "<note title>" }]
}
PLAN
```

Every open Item appears once in `items`, in table order: `filed` with its note path, its `section` only for Weekly Note sections, and the exact lines from its row; `dropped` for a `drop`; `skipped` for everything else. `inserts` holds only the link line, when the plan has one; `routes` only the Routes the user accepted (ones already in the Routes note are skipped).

- **Exit 0**: it prints `filed`, `dropped`, `skipped` and `movedTo` (set when the Dump is finished and moved to `Inbox/Filed/`). Report that, then go to the next Dump.
- **`Filing Plan rejected: …`**: nothing was written. Tell the user the reason, then offer to adjust the plan or skip this Dump.

Done when every Dump has been applied, skipped, or the user cancelled, and the user has a one-line summary of the run.
