---
name: file
description: File the Inbox's Dumps into the Vault, one approved Filing Plan per Dump, or undo a Filing.
disable-model-invocation: true
allowed-tools: Bash(brain-dump:*)
---

When the user asks to undo a Filing ("undo the last Filing"), skip to [Undo](#undo).

Otherwise, work through every unfiled **Dump** in the Vault's Inbox, oldest first. For each one, show a **Filing Plan**, take the user's reply, and hand the approved plan to the `brain-dump` helper, which does every write. Vocabulary (Dump, Item, Filing, Filing Plan, Weekly Note, Todo Group, Topic Note, Project Note, Route) follows the Brain-Dump glossary. Filing is append-only: the helper adds lines; nothing existing is rewritten.

## 1. Load the Inbox and the Vault's map

First run `brain-dump check --json`, which reports Vault problems and writes nothing: a list of `{kind, note, detail, fix}`, exiting 1 when there are findings. Show one line before anything else: `Vault check: N findings (<count> <kind>, …); run brain-dump check for details`, or `Vault check: clean`. Don't act on the findings; Filing goes on either way. If it exits 2, say `Vault check failed: <its error>` and go on.

Then run these once per run:

- `brain-dump list-dumps`: each unfiled Dump's `file`, `title`, `date`, `project`, `hash`, and `items` (`index`, `kind`, `text`, `rationale`, `state`). Only `open` Items are filed.
- `brain-dump list-notes`: every note's `note` (path), `title`, `folder`, `tags` and `hash`.
- `brain-dump routes`: `{hash, routes}`, the Routes note's `hash` (`null` when it doesn't exist yet) and the user's **Routes**, mapping a project or subject to where it belongs: `{key, title}` for a note's title, `{key, group}` for a Todo Group path.

Every `hash` is the file's content as you read it. Keep them: each plan hands back the hashes of the files it writes (step 6), so the helper can refuse a plan built on a note that changed since.

If there are no Dumps, tell the user the Inbox is clear. Done.

## 2. Find the Weekly Notes

- **This week's** (for Todos): `brain-dump weekly-note --date <today, YYYY-MM-DD>`.
- **The Session's week** (for the link line): `brain-dump weekly-note --date <the Dump's date>`.

Each prints `{"exists": …, "note": …, "hash": …}` (`hash` is `null` when the note doesn't exist). When `exists` is false, `note` is the path a new Weekly Note for that week would have: propose creating it (a **NEW** row, see step 4) as a verbatim copy of the Weekly Note template. When the Session's week is this week, both are the same note: create it once.

Then `brain-dump todo-groups --date <today, YYYY-MM-DD>`: the **Todo Groups** of this week's note (`thisWeek`, with its `hash`) and of the latest earlier Weekly Note (`lastWeek`, or `null`), each a nested `{name, children}` tree. A Todo Group is a plain bullet (no checkbox) under `# To-Do:` or under another group, gathering one project's or one kind of work's Todos, e.g. `Dissertation` holding `IRB`.

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

An Item is **routine** when its destination came from a Route (a note Route, or a group Route for a Todo) and that destination already exists: the note, and for a Todo every level of its group path. Remember the Route's `key` for each routine Item. An Item whose destination is NEW, or that you placed by matching titles, folders, tags or group names, is not routine.

Done when every open Item has a destination note, existing or NEW, every Todo a group, existing, NEW or ungrouped, and you know which Items are routine.

## 4. Show the Filing Plan

One numbered table per Dump, one row per open Item that isn't routine, numbered by the Item's `index`:

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

Mark every destination that doesn't exist yet with **NEW**, including each new level of a group path. Anything NEW always goes in the table, never in the Routine list.

Below the table, list the routine Items compactly, in `index` order, headed `Routine (N)` with N the number of entries, one line each with its index, kind, a short excerpt, and where it goes:

```
Routine (3)
3 · Learning: Codex reads ~/.agents/skills… → `Agent Skills` (via Route "Agent Skills")
6 · Todo: Ship the file skill → `10-05-26 Weekly Update` · `Brain Dump` (via Route "brain-dump")
+ · Link line → `10-05-26 Weekly Update` · `# Notes:`
```

The link line is routine too, listed as `+`, unless its Weekly Note is NEW. When every row is routine, show no table: only the Routine list, the notes below, and the replies. Routine Items are approved like every other row, by the same `ok`; nothing is written without one.

Then:

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
- `ok`: apply the plan as it stands. If the plan writes or creates more than 8 distinct notes, not counting its Dump or the Routes note, first ask a separate question: "This plan writes N notes. Apply all of them?" Only an explicit yes to that question sets `confirmLarge`; anything else returns to the plan. The `ok` itself never counts as that yes.

Every reply acts on routine Items as it does on table rows. A redirect (`N → …`) or `edit N` makes Item N no longer routine: show it in the table from then on, and send no `route` for it.

After anything but `ok` or `cancel`, show the updated plan (the link-line rule may change) and wait again.

## 6. Apply

Build the plan as JSON and pass it on stdin:

```bash
brain-dump apply <<'PLAN'
{
  "dump": "<file>",
  "expect": { "<file>": "<its hash>", "<this week's note>": "<its hash>", "<Topic Note path>": "<its hash>" },
  "creates": [
    { "note": "Research/Weekly Meetings/10-12-26 Weekly Update.md", "from": "weekly-template" },
    { "note": "Research/Main Notes/Agent Skills.md", "tags": ["LLMs", "VibeCoding"] }
  ],
  "items": [
    { "index": 1, "outcome": "filed", "note": "<Topic Note path>", "lines": ["- Codex reads ~/.agents/skills.", "\t- From [[<title>|dump 10-05-26]]"] },
    { "index": 4, "outcome": "filed", "note": "<this week's note>", "section": "# To-Do:", "group": ["Brain Dump"], "lines": ["- [ ] Ship the file skill. #todo"], "route": "brain-dump" },
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

`expect` maps every existing file the plan writes to its `hash`: the Dump, each existing note an Item or the link line goes into, and the Routes note when the plan adds Routes to it. Use the hash from your latest read, or from an earlier `apply` in this run that wrote the file (its `hashes`). NEW notes and a Routes note that doesn't exist yet need none; the helper refuses a plan missing any other. `creates` lists every NEW note still in the plan, each once; a NEW note nothing is filed into any more (its Items skipped or redirected) is left out, and the helper rejects one left in. Every open Item appears once in `items`, in table order: `filed` with its note path, its `section` only for Weekly Note sections, and the exact lines from its row; `dropped` for a `drop`; `skipped` for everything else. A grouped Todo carries its `group` path, unindented `lines` (the helper indents them), and no `group` when ungrouped. `createGroups` lists each NEW group path once, its full path; every missing level along it is created, and the helper rejects a path a Todo names that neither exists nor is listed, a listed path that already exists, one no Todo is filed into, and a path matching two bullets. Each routine Item carries `"route"`, the `key` of the Route its destination came from; the helper refuses the whole plan if that Route isn't in the Routes note, doesn't point at the Item's note or Todo Group, or points at one that doesn't exist yet. Items that aren't routine carry no `route`. `inserts` holds only the link line, when the plan has one; `routes` only the Routes the user accepted (ones already in the Routes note are skipped). `"confirmLarge": true` goes in only after the user's separate yes to a plan over 8 notes (step 5); never set it otherwise.

- **Exit 0**: it prints `filed`, `dropped`, `skipped`, `movedTo` (set when the Dump is finished and moved to `Inbox/Filed/`) and `hashes`, the new hash of every file it wrote. Swap those into your hashes for the later plans in this run. Report the counts, then go to the next Dump.
- **`Filing Plan stale: <note> changed since it was read`** (one or more notes): nothing was written; the user or Sync changed those files after you read them. Re-run the reads from steps 1 and 2, rebuild this Dump's plan from what's there now, and show it again headed `Re-planned: [[X]] changed since you last saw it` (each changed note's title). Carry over the user's earlier replies (redirects, drops, edits, accepted Routes and tags) where they still apply, and wait for a fresh `ok`; the earlier `ok` no longer counts.
- **`write refused: the plan writes N notes, more than 8, so it needs confirmLarge`**: nothing was written. Ask the separate question from step 5; on a yes, apply again with `confirmLarge`.
- **`Filing Plan rejected: Item N claims Route …`**: nothing was written. You marked Item N routine when it isn't. Show the plan again with Item N in the table, and wait for a fresh `ok`.
- **`Filing Plan rejected: …`** (anything else): nothing was written. Tell the user the reason, then offer to adjust the plan or skip this Dump.

Done when every Dump has been applied, skipped, or the user cancelled, and the user has a one-line summary of the run.

## Undo

Each `apply` is one **Run**, and undo reverts a whole Run, exactly, or nothing.

1. Run `brain-dump runs`: the 20 latest Runs, newest first, each with `id`, `time`, `command`, `label` (the Dump's title for an `apply`), `files` and `status`. "The last Filing" is the first Run with `command` `apply` and `status` `applied`, or `pending` (a Filing that crashed partway, still undoable); when the user names a Dump, match its `label`. If none fits, say so and stop.
2. Run `brain-dump undo <id>`. Without `--confirm` it writes nothing and prints `files`: each Vault file with its `action`, `restore` (back to its copy from before the Run), `delete` (a file the Run created) or `skip` (already as before). Show the user the Run's `label` and `time` and every file with its action, and ask whether to undo it.
3. Only on an explicit yes, run `brain-dump undo <id> --confirm`. It prints the same report with `run`, the id of the undo's own Run; undoing that Run redoes the Filing. Anything but a yes writes nothing.

When undo refuses, nothing was written. Tell the user its reason:

- **`cannot undo run <id>, because files changed since it:`** with each file and its cause. For `undo run <later id> first`, offer to undo that later Run first, starting again at step 2. For `changed outside Brain-Dump since <time>`, the user edited the file (or Sync changed it); undo can't revert it without losing that edit.
- **`it was made in the Vault at …`**: the Run belongs to another Vault, so it can't be undone here.
- **`nothing to undo`**: the Run is already undone.
