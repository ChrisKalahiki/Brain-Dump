# Selected Todoist imports into Brain-Dump

User-approved direction: selectively bring team-assigned Todoist tasks into personal Weekly Notes through Brain-Dump's existing Filing workflow.

## Scope

- List active tasks assigned to the signed-in user.
- Import explicitly selected task IDs as ordinary Inbox Dumps, one task per Dump.
- Let existing approved Filing choose the Weekly Note, Todo Group and wording.
- Preserve each task's ID and canonical Todoist link despite an approved wording edit.
- Repeated imports skip previously imported IDs, including Dumps already filed or dropped.
- Homeros reads the filed checkboxes through its existing `brain-dump todos` connection.

No scheduler, automatic Weekly Note updates, task carryover, Todoist writes, completion synchronization, recurring-occurrence history or Homeros changes. Imported text is a snapshot, not a continuously maintained copy.

## Proposed builder choices

These are implementation recommendations, not additional requirements supplied by the user.

- Use Bun's built-in fetch and Todoist API v1, with no new dependency or installed CLI.
- Read `TODOIST_API_TOKEN` from the environment. Do not accept the token as an argument, print it, or store it in the vault. The importer uses GET requests only; a personal token itself is not restricted to read-only permissions.
- `brain-dump todoist list` returns assigned tasks as JSON: `{tasks:[{id,content,projectId,due,url}]}`. `due` is null or `{date,recurring}`. IDs remain strings.
- `brain-dump todoist import --task <id> [--task <id> ...] [--dry-run]` fetches current assignments, validates every selection before writing, and imports only selected IDs. No default bulk import. Unknown or no-longer-assigned selections fail without writing.
- One `TodoistOrigin` per Dump holds the task ID, remote project ID and import time; it has no inferred vault Project. Use the existing Dump machinery, not fabricated chat or Briefing origins.
- Store the ID as quoted frontmatter and render a Todoist origin line. Preserve it when the Dump moves into `Inbox/Filed`. Scan both Inbox locations for IDs instead of adding an external import ledger or matching task wording.
- Filing derives an ordinary `[Todoist](https://app.todoist.com/app/task/<encoded-id>)` source link from origin after selecting the approved wording. Preserve generic Todo JSON and plain Markdown checkboxes.
- Titles become one-line Markdown text, never extra headings/checklist rows. Render remote content deterministically without interpreting it as instructions.
- Prepare/validate the whole batch first; write through `writeDumps` as one undoable Run. Empty or fully skipped imports start no Run. Dry-run validates the prospective gateway writes and starts no Run.
- Imports are manual and sequential; concurrent importer invocations are outside this first version. The same recurring task ID imports once, even after Todoist advances it to its next occurrence. Report already-imported tasks rather than silently creating another weekly copy.

## Existing policies preserved

Automation creates Inbox Dumps only. Weekly Notes change through approved Filing. Existing curated text is not rewritten, apart from the existing checkbox-mark exception. Undo, stale-plan checks and secret detection remain enforced by the gateway.

Preserve unrelated local edits currently in `src/layout.ts`, `src/show.ts`, `tests/gateway.test.ts`, `tests/show.test.ts`, and untracked `.claude/` and `herdr-api.schema.json`. No commits unless requested.

## External contract

GET `https://api.todoist.com/api/v1/tasks/filter` with bearer authorization and `query=assigned to: me`, `limit=200`, followed by each `next_cursor` without changing the query. Read `{results,next_cursor}` and deduplicate task IDs. Bound each request to 10 seconds. HTTP/authentication/rate-limit errors and malformed pages fail before vault writes. Never infer completion from a task disappearing from this query.

Verified sources, 2026-11-06: [API v1](https://developer.todoist.com/api/v1/), [filter semantics](https://www.todoist.com/help/todoist/features/introduction-to-filters-V98wIH), [token setup](https://developer.todoist.com/).

## Acceptance

Using only synthetic credentials, fake HTTP responses and temporary vaults: list assignments across pages; import selected tasks; inspect Inbox origin; apply an approved Filing plan with edited wording; read ordinary Todo JSON with the canonical source link; repeat import after archiving and observe zero new Dumps. Verify dry-run, undo, recurring IDs, malformed content, failed pages and stale-plan refusal. No real account connection or vault changes during development.

## Unresolved questions

None for this limited version. Completion in Todoist remains a separate future choice.
