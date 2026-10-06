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

Each prints `{"exists": …, "note": …}`. When `exists` is false, `note` is the path a new Weekly Note for that week would have: propose creating it (a **NEW** row, see step 4) as a verbatim copy of the Weekly Note template.

## 3. Route each Item

- **Todo** → this week's Weekly Note, section `# To-Do:`.
- **Learning** → the **Topic Note** it best belongs in.
- **Decision** → a Topic Note when it is really about a general subject (a tool, a technique); otherwise the **Project Note** for the Dump's project. When unsure, the Project Note.

To find a note: check the Routes first (a Route whose key matches the Dump's `project` or the Item's subject), then match titles, folders and tags from `list-notes`. Project Note titles vary ("Context Bridge MCP Main Note", "Virtual Assistant Project"), so look inside the project's folder.

When no existing note fits, propose a **NEW** note:

- **Project Note** → `Side Projects/<Project>/<Project>.md`.
- **Topic Note** for a research subject → `Research/Main Notes/<Subject>.md`.
- **Tags**: pick from tags already in `list-notes` (CamelCase topics like `LLMs`, plus `SideProject` / `project` for projects). A tag that doesn't exist yet is only a proposal: list it separately; it is used only if the user accepts.

Done when every open Item has a destination note, existing or NEW.

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

Mark every destination that doesn't exist yet with **NEW**. Below the table:

- **New notes**: each NEW note with its folder and tags (and "copy of the Weekly Note template" for a Weekly Note).
- **Proposed new tags**: any tag that isn't in the Vault yet, or "none".
- Filing is append-only, and the replies: `ok` · `skip N` · `drop N` · `N → [[Note]]` · `N → <folder>/` · `add tags` · `show N` · `edit N` · `cancel` (combinable, e.g. `3 → [[Zotero Plug-in for Obsidian]], show 4`).

Done when the plan is on screen and nothing has been written.

## 5. Take the reply

- `skip N`: Item N stays open for a later run.
- `drop N`: Item N will never be filed (marked `[-]`); remove its row.
- `N → [[Note]]`: send Item N to that existing note instead. Then offer the redirect back as a Route, e.g. "Remember `<project or subject> → [[Note]]`?"; a yes adds it to this plan's `routes`.
- `N → <folder>/`: keep Item N's NEW note but create it in that folder.
- `add tags`: accept the proposed new tags; without it, NEW notes get only existing tags.
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
  "creates": [
    { "note": "Research/Weekly Meetings/10-12-26 Weekly Update.md", "from": "weekly-template" },
    { "note": "Research/Main Notes/Agent Skills.md", "tags": ["LLMs", "VibeCoding"] }
  ],
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

`creates` lists every NEW note still in the plan; a declined one (its Items skipped or redirected) is left out. Every open Item appears once in `items`, in table order: `filed` with its note path, its `section` only for Weekly Note sections, and the exact lines from its row; `dropped` for a `drop`; `skipped` for everything else. `inserts` holds only the link line, when the plan has one; `routes` only the Routes the user accepted (ones already in the Routes note are skipped).

- **Exit 0**: it prints `filed`, `dropped`, `skipped` and `movedTo` (set when the Dump is finished and moved to `Inbox/Filed/`). Report that, then go to the next Dump.
- **`Filing Plan rejected: …`**: nothing was written. Tell the user the reason, then offer to adjust the plan or skip this Dump.

Done when every Dump has been applied, skipped, or the user cancelled, and the user has a one-line summary of the run.
