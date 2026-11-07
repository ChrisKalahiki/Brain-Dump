# Todoist Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Import selected team-assigned Todoist tasks through Brain-Dump's approved Filing, retaining identity and source links.

**Architecture:** One task becomes one typed-origin Dump. Read assignments over API v1; deduplicate IDs against Inbox and Filed Dumps; use existing gateway, Run and Filing machinery. No generic Todo schema changes.

**Tech Stack:** Existing Bun, TypeScript, bun:test and built-in fetch; no new dependencies.

**Spec:** `../specs/2026-11-06-todoist-import-design.md`

## Global Constraints

- Use Bun, no new dependencies, no type-error suppression.
- No scheduler, automatic Weekly Note updates, task carryover, Todoist writes, completion synchronization, recurring-occurrence history or Homeros changes.
- Automation creates Inbox Dumps only; Weekly Notes change through approved Filing.
- IDs remain strings; token comes only from `TODOIST_API_TOKEN` and never reaches output or vault content.
- Preserve unrelated checkout edits. No commits unless requested.
- Develop against temporary vaults and synthetic responses, never the real account or vault.

## Review Focus

1. Renamed, archived or dropped task: reimport must still skip its ID.
2. Approved wording edit: filed checkbox must retain its canonical Todoist link.
3. Failed later API page or invalid selection: no partially imported batch.
4. Malicious/multiline title or malformed identity: preserve valid Markdown and refuse unsafe input without losing source identity.
5. Recurring task or repeated page entry: one import per task ID, with explicit skipped results.

## Task 1: Typed Todoist Dump identity

**Files:** modify `src/origin.ts`, `src/dump.ts`; add `src/todoist-origin.ts`, `tests/todoist-origin.test.ts`; extend `tests/dump-document.test.ts` and `tests/recall.test.ts` only where the new origin exercises existing assumptions.

**Interfaces:**
- Add `TODOIST = "Todoist"` and `TodoistOrigin = {kind:"todoist";tool:typeof TODOIST;task:string;remoteProject:string;project:undefined;at:Date}` to `Origin`.
- `todoistTaskUrl(task:string):string` encodes the opaque ID into the canonical app URL.
- Dump rendering/parsing round-trips the new origin, including quoted `todoist-task` and `todoist-project` frontmatter. No public expansion of `write-dump` flags is needed.

- [x] Write failing tests: round-trip IDs as strings; preserve remote project and import date; reject blank/control-character IDs; reject session coverage on a Todoist origin; reject mismatched origin/frontmatter; preserve existing Session and Briefing origins.
- [x] Run `bun run test:file -- tests/todoist-origin.test.ts tests/dump-document.test.ts`; confirm missing-feature failures.
- [x] Implement origin rendering, parsing and validation through existing Dump document functions; keep changes focused and update exhaustive origin consumers identified by typechecking.
- [x] Run the focused tests and `bun run typecheck`; require success.

## Task 2: Read and select assigned tasks

**Files:** add `src/todoist-api.ts`, `tests/todoist-api.test.ts`.

**Interfaces:**
- Export `TodoistTask = {id:string;content:string;projectId:string;due:{date:string;recurring:boolean}|null;url:string}`.
- `readAssignedTodoistTasks(token:string, request:typeof fetch = fetch):Promise<TodoistTask[]>` performs only the fixed-origin paginated GET flow from the spec.

- [x] Write failing tests with injected fetch and real Response objects: URL/filter/auth, two pages, opaque IDs, repeated IDs, null and recurring due dates, malformed envelopes/fields, 401, 429, failed second page, timeout, and errors that never echo credentials or response bodies.
- [x] Run `bun run test:file -- tests/todoist-api.test.ts`; confirm missing-feature failures.
- [x] Implement validation, bounded requests, pagination and normalization; follow existing error conventions. Do not add an endpoint override or real network access in tests.
- [x] Rerun focused tests and typecheck; require success.

## Task 3: Selected imports and canonical Filing links

**Files:** add `src/todoist.ts`, `tests/todoist-import.test.ts`, `tests/todoist-filing.test.ts`; modify `src/cli.ts` and the narrow `renderItem` seam in `src/filing.ts`.

**Interfaces:**
- `importTodoistTasks(vault:Vault,tasks:TodoistTask[],ids:string[],options:{at:Date;dryRun?:boolean}):TodoistImportResult` consumes already fetched assignments, validates the entire selection, then prepares and commits Dumps.
- `TodoistImportResult = {run:string|null;imported:{id:string;dump:string}[];skipped:{id:string;dump:string}[];preview?:{id:string;dump:string;contents:string}[]}`. Preview means no committed imports; an all-skipped result has `run:null`.
- A focused helper scans typed Todoist identities from both Inbox folders. Refuse an unreadable Todoist-tagged identity rather than silently duplicating it; unrelated malformed Dumps do not block import.
- CLI: `todoist list`; `todoist import --task <id>` with repeatable `--task` and optional `--dry-run`. List never locates or writes the vault. Import requires a nonempty selection and token before network or writes.

- [x] Write failing sandbox tests: selected-only import; repeat selection; renamed task; filed/dropped Dump; recurring ID; identical titles with distinct IDs; dry-run; full-batch refusal on unknown IDs; no Run when empty/skipped; undo restores pre-import state; malformed multiline/title delimiters cannot create extra Items.
- [x] Write failing Filing tests: edited wording still gets exactly one canonical source link; ordinary Todos retain existing rendering; source identity survives archiving; `readTodos` returns a normal checkbox with the link; stale Filing plan is refused.
- [x] Run `bun run test:file -- tests/todoist-import.test.ts tests/todoist-filing.test.ts`; confirm expected failures.
- [x] Implement via `prepareDump` and `writeDumps`, preserving gateway checks and applying the canonical link after approved wording selection. No external ledger or generic Todo schema additions.
- [x] Add CLI tests for help/usage errors, repeated task flags, missing credentials and JSON output. Exercise network behavior through `readAssignedTodoistTasks` injection; do not add production configuration solely to mock a CLI endpoint.
- [x] Run focused tests plus `tests/apply.test.ts`, `tests/todos.test.ts`, `tests/undo.test.ts`, then typecheck; require success.

## Task 4: Document the flow and verify

**Files:** modify `README.md` and `GLOSSARY.md` only to describe the new origin and actual shipped behavior; place this spec and plan under `docs/superpowers/` in the Brain-Dump workspace. Use domain-modeling before editing the glossary. No agent skill/prompt edits are planned.

- [x] Document token setup, list → select → import → existing `/file` workflow, snapshot semantics, repeated/recurring-ID behavior, dry-run and undo. Explain that personal checkboxes do not update Todoist. Document one importer invocation at a time.
- [x] Run `bun run typecheck`, `bun run glossary`, `bun run test`, and `bun run eval:check`. This repo has no lint script. If eval hashes are stale, report and run exactly the named evals where the environment supports them; never fabricate a recorded pass.
- [x] Review the diff against the spec; verify unrelated dirty files are unchanged and no tokens, real task data or generated account files are present.
- [x] Obtain one whole-change code review, fix findings and rerun affected checks. Report evidence and any required real-account hand check. Do not commit, connect the account, or import real tasks without a separate explicit instruction.

## Unresolved questions

None. Native execution completed on feat/todoist-import in an isolated Brain-Dump worktree; integration remains the user’s choice.
