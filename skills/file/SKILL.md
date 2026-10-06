---
name: file
description: File the Inbox's Dumps into the Vault, one approved Filing Plan per Dump.
disable-model-invocation: true
allowed-tools: Bash(brain-dump:*)
---

Work through every unfiled **Dump** in the Vault's Inbox, oldest first. For each one, show a **Filing Plan**, take the user's reply, and hand the approved plan to the `brain-dump` helper, which does every write. Vocabulary (Dump, Item, Filing, Filing Plan, Weekly Note) follows the Brain-Dump glossary. Filing is append-only: the helper adds lines; nothing existing is rewritten.

## 1. Load the Inbox

Run `brain-dump list-dumps`. It prints JSON: each Dump's `file`, `title`, `date`, `project`, and its `items` (`index`, `kind`, `text`, `rationale`, `state`). Only `open` Items are filed.

If the list is empty, tell the user the Inbox is clear. Done.

## 2. Find the Weekly Notes

- **This week's** (for Todos): `brain-dump week-note --date <today, YYYY-MM-DD>`.
- **The Session's week** (for the link line): `brain-dump week-note --date <the Dump's date>`.

Each prints `{"exists": …, "note": …}`. A Weekly Note that doesn't exist yet can't take lines in this version: Items bound for it stay open.

## 3. Show the Filing Plan

One numbered table per Dump, one row per open Item, numbered by the Item's `index`:

| # | Item | → Destination | As |
|---|---|---|---|
| 4 | Todo: Ship the file skill | `10-05-26 Weekly Update` · `# To-Do:` | `- [ ] Ship the file skill. #todo` |
| 1 | Learning: Bun runs TypeScript… | not routable yet | stays open |

- **Todo** → this week's Weekly Note, section `# To-Do:`, as `- [ ] <text> #todo` (the Item's text with its `#todo` moved to the end).
- **Learning / Decision** → "not routable yet", stays open.
- **Link line**, when at least one Item is filed → the Session's week, section `# Notes:`, as `- Filed [[<title>|<project> <short title>]]`. Show it as a row marked `+`.

Below the table, say Filing is append-only and list the replies: `ok` · `skip N` · `drop N` · `cancel` (combinable, e.g. `drop 2, skip 3`).

Done when the plan is on screen and nothing has been written.

## 4. Take the reply

- `skip N`: Item N stays open for a later run.
- `drop N`: Item N will never be filed (marked `[-]`); remove its row.
- `cancel`: write nothing, stop the whole run.
- `ok`: apply the plan as it stands.

After a `skip` or `drop`, show the updated plan and wait for `ok`.

## 5. Apply

Build the plan as JSON and pass it on stdin:

```bash
brain-dump apply <<'PLAN'
{
  "dump": "<file>",
  "items": [{ "index": 4, "outcome": "filed" }, { "index": 2, "outcome": "dropped" }, { "index": 1, "outcome": "skipped" }],
  "inserts": [
    { "note": "<this week's note>", "section": "# To-Do:", "lines": ["- [ ] Ship the file skill. #todo"] },
    { "note": "<the Session's week note>", "section": "# Notes:", "lines": ["- Filed [[<title>|<project> <short title>]]"] }
  ]
}
PLAN
```

Every open Item appears once in `items`: `filed` for a row with a destination, `dropped` for a `drop`, `skipped` for everything else. Lines bound for the same note and section go in one insert, in table order.

- **Exit 0**: it prints `filed`, `dropped`, `skipped` and `movedTo` (set when the Dump is finished and moved to `Inbox/Filed/`). Report that, then go to the next Dump.
- **`Filing Plan rejected: …`**: nothing was written. Tell the user the reason, then offer to adjust the plan or skip this Dump.

Done when every Dump has been applied, skipped, or the user cancelled, and the user has a one-line summary of the run.
