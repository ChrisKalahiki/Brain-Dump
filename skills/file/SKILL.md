---
name: file
description: File the Inbox's Dumps into the Vault, one approved Filing Plan per Dump.
disable-model-invocation: true
allowed-tools: Bash(brain-dump:*)
---

Work through every unfiled **Dump** in the Vault's Inbox, oldest first. For each one, show a **Filing Plan**, take the user's reply, and hand the approved plan to the `brain-dump` helper, which does every write. Vocabulary (Dump, Item, Filing, Filing Plan, Weekly Note, Todo Group, Topic Note, Project Note, Route) follows the Brain-Dump glossary. Filing is append-only: the helper adds lines; nothing existing is rewritten.

## 1. Load the Inbox and the Vault's map

Run these once per run:

- `brain-dump list-dumps`: each unfiled Dump's `file`, `title`, `date`, `project`, and `items` (`index`, `kind`, `text`, `rationale`, `state`). Only `open` Items are filed.
- `brain-dump list-notes`: every note's `note` (path), `title`, `folder` and `tags`.
- `brain-dump routes`: the user's **Routes**, mapping a project or subject to where it belongs: `{key, title}` for a note's title, `{key, group}` for a Todo Group path.

If there are no Dumps, tell the user the Inbox is clear. Done.

## 2. Find the Weekly Notes

- **This week's** (for Todos): `brain-dump weekly-note --date <today, YYYY-MM-DD>`.
- **The Session's week** (for the link line): `brain-dump weekly-note --date <the Dump's date>`.

Each prints `{"exists": …, "note": …}`. When `exists` is false, `note` is the path a new Weekly Note for that week would have: propose creating it (a **NEW** row, see step 4) as a verbatim copy of the Weekly Note template. When the Session's week is this week, both are the same note: create it once.

Then `brain-dump todo-groups --date <today, YYYY-MM-DD>`: the **Todo Groups** of this week's note (`thisWeek`) and of the latest earlier Weekly Note (`lastWeek`, or `null`), each a nested `{name, children}` tree. A Todo Group is a plain bullet (no checkbox) under `# To-Do:` or under another group, gathering one project's or one kind of work's Todos, e.g. `Dissertation` holding `IRB`.

## 3. Route each Item

- **Todo** → this week's Weekly Note, section `# To-Do:`, inside the Todo Group it belongs to (see below).
- **Learning** → the **Topic Note** it best belongs in.
- **Decision** → a Topic Note when it is really about a general subject (a tool, a technique); otherwise the **Project Note** for the Dump's project. When unsure, the Project Note.

To find a note: check the Routes first (a Route whose key matches the Dump's `project` or the Item's subject), then match titles, folders and tags from `list-notes`. Project Note titles vary ("Context Bridge MCP Main Note", "Virtual Assistant Project"), so look inside the project's folder.

When no existing note fits, propose a **NEW** note:

- **Project Note** → `Side Projects/<Project>/<Project>.md`.
- **Topic Note** for a research subject → `Research/Main Notes/<Subject>.md`.
- **Tags**: pick from tags already in `list-notes` (CamelCase topics like `LLMs`, plus `SideProject` / `project` for projects). A tag that doesn't exist yet is only a proposal: list it separately; it is used only if the user accepts.

To pick a Todo's group, decide per Todo, not per Dump: one chat Dump can hold Todos for several projects, and the Dump's `project` is only a hint. Check group Routes first (`{key, group}` whose key matches the Todo's project or subject), then the names in `thisWeek`, then `lastWeek`. A group is named by its path, written `Dissertation › IRB`; names match ignoring case and a trailing colon.

- A group found only in `lastWeek` is **NEW** in this week's note under the same name (with every missing level along its path).
- When no group fits, propose a **NEW** group or subgroup, at any depth, e.g. **NEW** `IRB` inside an existing `Dissertation`.
- A Todo goes ungrouped (top level of `# To-Do:`) only when the user says so.

Done when every open Item has a destination note, existing or NEW, and every Todo a group, existing, NEW or ungrouped.

## 4. Show the Filing Plan

One numbered table per Dump, one row per open Item, numbered by the Item's `index`:

| # | Item | → Destination | As |
|---|---|---|---|
| 1 | Learning: Codex reads ~/.agents/skills | `Agent Skills` · end | bullet + backlink |
| 2 | Decision: Filing is append-only | `Brain-Dump` · end | bullet + Why + backlink |
| 4 | Todo: Ship the file skill | `10-05-26 Weekly Update` · `# To-Do:` › `Brain Dump` | `- [ ] Ship the file skill. #todo` |
| 5 | Todo: Finish the IRB application | `10-05-26 Weekly Update` · `# To-Do:` › `Dissertation` › **NEW** `IRB` | `- [ ] Finish the IRB application. #todo` |

What each row appends:

- **Todo**: `- [ ] <text> #todo` (the Item's text with its `#todo` moved to the end), in its Todo Group under `# To-Do:`. The helper indents it one level below the group and places it after the group's last direct Todo; a NEW group goes at the end of its parent. No backlink.
- **Learning**: `- <text>` then `\t- From [[<title>|dump MM-DD-YY]]`, at the end of the note.
- **Decision**: `- <text>`, `\t- Why: <rationale>`, then `\t- From [[<title>|dump MM-DD-YY]]`, at the end of the note.
- **Link line** → the Session's week, section `# Notes:`, as `- Filed [[<title>|<project> <slug>]]`, where `<slug>` is the part of the title after ` - `. Add it only when this plan finishes the Dump (no Item left open) and at least one of its Items is filed, now or in an earlier run; that way each Dump gets exactly one. Show it as a row marked `+`.

Mark every destination that doesn't exist yet with **NEW**, including each new level of a group path. Below the table:

- **New notes**: each NEW note with its folder and tags (and "copy of the Weekly Note template" for a Weekly Note).
- **New groups**: each NEW Todo Group path, or "none".
- **Proposed new tags**: any tag that isn't in the Vault yet, or "none".
- Filing is append-only, and the replies: `ok` · `skip N` · `drop N` · `N → [[Note]]` · `N → <folder>/` · `N → <group path>` · `N → ungrouped` · `add tags` · `show N` · `edit N` · `cancel` (combinable, e.g. `3 → [[Zotero Plug-in for Obsidian]], show 4`).

Done when the plan is on screen and nothing has been written.

## 5. Take the reply

- `skip N`: Item N stays open for a later run.
- `drop N`: Item N will never be filed (marked `[-]`); remove its row.
- `N → [[Note]]`: send Item N to that note instead: an existing one, or a NEW note another row in this plan proposes. Then offer the redirect back as a Route, e.g. "Remember `<project or subject> → [[Note]]`?"; a yes adds it to this plan's `routes`.
- `N → <folder>/`: keep Item N's NEW note but create it in that folder.
- `N → <group path>` (e.g. `5 → Dissertation › IRB`): put Todo N in that Todo Group instead, marking any level that doesn't exist as **NEW**. Then offer it back as a Route, e.g. "Remember `<project or subject> → To-Do › Dissertation › IRB`?"; a yes adds `{ "key": …, "group": [ … ] }` to this plan's `routes`.
- `N → ungrouped`: Todo N goes at the top level of `# To-Do:`, outside any group.
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
    { "index": 4, "outcome": "filed", "note": "<this week's note>", "section": "# To-Do:", "group": ["Brain Dump"], "lines": ["- [ ] Ship the file skill. #todo"] },
    { "index": 5, "outcome": "filed", "note": "<this week's note>", "section": "# To-Do:", "group": ["Dissertation", "IRB"], "lines": ["- [ ] Finish the IRB application. #todo"] },
    { "index": 2, "outcome": "dropped" },
    { "index": 3, "outcome": "skipped" }
  ],
  "inserts": [
    { "note": "<the Session's week note>", "section": "# Notes:", "lines": ["- Filed [[<title>|<project> <slug>]]"] }
  ],
  "createGroups": [["Dissertation", "IRB"]],
  "routes": [{ "key": "<project or subject>", "title": "<note title>" }, { "key": "<project or subject>", "group": ["Dissertation", "IRB"] }]
}
PLAN
```

`creates` lists every NEW note still in the plan, each once; a NEW note nothing is filed into any more (its Items skipped or redirected) is left out, and the helper rejects one left in. Every open Item appears once in `items`, in table order: `filed` with its note path, its `section` only for Weekly Note sections, and the exact lines from its row; `dropped` for a `drop`; `skipped` for everything else. A grouped Todo carries its `group` path, unindented `lines` (the helper indents them), and no `group` when ungrouped. `createGroups` lists each NEW group path once, its full path; every missing level along it is created, and the helper rejects a path a Todo names that neither exists nor is listed, a listed path that already exists, one no Todo is filed into, and a path matching two bullets. `inserts` holds only the link line, when the plan has one; `routes` only the Routes the user accepted (ones already in the Routes note are skipped).

- **Exit 0**: it prints `filed`, `dropped`, `skipped` and `movedTo` (set when the Dump is finished and moved to `Inbox/Filed/`). Report that, then go to the next Dump.
- **`Filing Plan rejected: …`**: nothing was written. Tell the user the reason, then offer to adjust the plan or skip this Dump.

Done when every Dump has been applied, skipped, or the user cancelled, and the user has a one-line summary of the run.
