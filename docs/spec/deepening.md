# Brain-Dump deepening spec

Terms are defined in [`GLOSSARY.md`](../../GLOSSARY.md). Tracked as [#95](https://github.com/ChrisKalahiki/Brain-Dump/issues/95). Each ticket links to its heading under Implementation Decisions.

## Problem Statement

Brain-Dump's builds keep paying for knowledge that has no single home. Four recent builds (the two Sweeps, the eval runner, the evals) showed the same friction:

- **A Dump's shape is spread across five places.** One module writes the filename, frontmatter and origin line; the Inbox listing, Recall, `check`, the evals and the test harness each read it back with their own patterns. "The Dump's project" means the filename label in Filing and the origin-line link in Recall. The Sweep builds its origin itself and skips the rules `write-dump` enforces.
- **Filed-Item lines are defined in prose but parsed in code.** The file skill spells out `From [[…]]`, `Why:`, `#todo` placement and the link line, and its rule for when the link line is due. The helper accepts any non-empty lines. Recall, `check`, Consolidation and duplicate detection parse those lines back, so a slightly-off line silently drops an Item from all four, and no test can catch it.
- **Session log formats are read in one place and written in two others.** Tests and evals hand-write Claude Code and Codex logs that must match the readers by hand; a Codex format change was found only by scanning real rollouts. The Session text form is written in local time and read back as UTC.
- **The Sweep is two modules in one.** Session selection and the drafting agent share a file, so the evals reach into the Sweep for the model, the spawn and reply parsing, and a lock change invalidates the drafting eval.
- **Eval inputs are hand-kept lists.** The File eval's list misses seven modules it reaches, so a change there leaves a stale pass green.
- **The guard's tool list is duplicated in the installer**, which has no tests.
- **No guardrail.** No hook or CI runs typecheck and tests; one build committed with a failing suite. Reviewers re-flag avoided Glossary words by hand.

## Solution

Deepen the modules where the knowledge belongs, behind small interfaces, so each format has one place that writes and reads it, and add the guardrail that makes these behaviour-preserving changes checkable. Nine tickets, in two chains plus independents:

- **00 Guardrail** blocks everything.
- **01 Dump document → 02 Filed-Item lines → 06 Vault Items** (06 is conditional).
- **03 Session log adapters → 04 Drafting agent → 05 Eval inputs.**
- **07 Guard matchers** and **08 Glossary check** depend only on 00.

From the user's side, Filing, the Sweep, Recall and `check` behave as today, with three visible changes: the file skill previews exact lines through a dry run, a chat Dump's project is the one its origin line names, and the installer no longer lists tool names.

## User Stories

1. As the Brain-Dump user, I want every commit checked by typecheck and the full test suite, so that a broken build never lands.
2. As the Brain-Dump user, I want CI to run the same check on every PR, so that nothing merges unchecked.
3. As an implementing agent, I want one `check` command, so that I don't guess which scripts exist.
4. As an implementing agent, I want the eval freshness gate outside the test suite, so that commits mid-ticket aren't blocked by evals I haven't rerun yet.
5. As a reviewer agent, I want the freshness gate reported by its own command, so that I stop flagging a known pending state as a test failure.
6. As the Brain-Dump user, I want a PR blocked when an eval is stale, so that skill changes never ship without a recorded pass.
7. As a maintainer, I want one module to write and read a Dump's filename, frontmatter and origin line, so that a format change is one edit.
8. As a maintainer, I want a round-trip test of the Dump document, so that what is written is provably what is read.
9. As the Brain-Dump user, I want the Sweep held to the same origin rules as `write-dump`, so that a swept Dump can't carry an origin `write-dump` would refuse.
10. As the Brain-Dump user, I want a Dump's Project to mean the Project its origin line names, so that Recall, the pointer and Filing agree on it.
11. As the Brain-Dump user, I want a chat Dump without a Project to keep its tool name as its label, so that its filename and link line read as today.
12. As the Brain-Dump user, I want Routes matched on a Dump's Project first and its label second, so that a chat Dump about a project files where that project's Routes say.
13. As a maintainer, I want parsing to return either the Dump or a named problem, so that `check` reports it and every other reader raises it.
14. As a maintainer, I want the test harness to build Dumps through the Dump module, so that tests stop checking against a copy of the format.
15. As a future reviewer, I want an ADR saying pure format modules are tested at their own interface, so that round-trip tests aren't flagged against ADR 0002.
16. As the Brain-Dump user, I want the helper to write every filed Item's lines, so that an Item can't silently fall out of Recall, `check` or Consolidation.
17. As the file skill, I want to send only where each Item goes and any edited wording, so that I don't have to reproduce line formats.
18. As the Brain-Dump user, I want `edit N` to change only an Item's wording, with `#todo` still moved to the end, so that editing behaves as today.
19. As the Brain-Dump user, I want the helper to add the link line exactly when the plan finishes the Dump and some Item is filed, so that each Dump gets one, without the skill tracking the rule.
20. As the Brain-Dump user, I want a NEW Weekly Note for the link line still listed for my approval, so that no note is created unseen.
21. As the Brain-Dump user, I want the Filing Plan table and `show N` to show the exact lines the helper will write, so that I approve what lands.
22. As the file skill, I want a dry run that validates the plan and renders its lines without writing, so that plan errors surface before `ok`.
23. As a maintainer, I want the plan schema to reject `lines` and `inserts` outright, so that only one Filing Plan shape exists.
24. As a maintainer, I want filed-Item lines written and read by one module, so that Recall, Digest counts, `check` and duplicates parse what was written.
25. As a maintainer, I want each Session log format written and read by one adapter, so that test and eval fixtures can't drift from the readers.
26. As a maintainer, I want the Session text form written and read by one module in local time, so that times round-trip.
27. As a maintainer, I want the old Codex log format covered by one frozen fixture, so that the reader keeps handling it without a writer for it.
28. As the Brain-Dump user, I want eval fixture Sessions cleaned up even after a killed run, so that my real Claude Code projects folder doesn't collect leftovers.
29. As a maintainer, I want the drafting agent in its own module, so that the Sweep is only "which Sessions, and what state".
30. As an eval author, I want the Sweep eval to depend on the drafting module alone, so that a lock or ledger change doesn't make it stale.
31. As an eval author, I want the rubric's grader to run through the evals' own runner, so that nothing in the evals imports the Sweep.
32. As an eval author, I want an eval's code inputs computed from its imports, so that no reached module is left out of its hash.
33. As an eval author, I want to declare only skill prose, prompts and fixtures by hand, so that eval definitions shrink to what imports can't see.
34. As a maintainer, I want the guard to report its own hook matchers, so that adding a tool to the guard can't leave the hook blind to it.
35. As the Brain-Dump user, I want the installer's guard descriptions generic, so that no tool name lives in the installer.
36. As a reviewer agent, I want avoided Glossary words caught by the check, so that I review judgement calls, not word lists.
37. As a maintainer, I want the Vault Items question re-asked after tickets 01 and 02, so that a module is built only if callers still re-join Items themselves.

## Implementation Decisions

Each ticket's decisions sit under its own heading; tickets link here by heading.

### 00 Guardrail

- A `check` script runs typecheck then the full test suite (about 30s).
- A plain git pre-commit hook in a tracked hooks folder runs `check`; a `prepare` script points git at that folder. No hook-manager dependency.
- A CI job runs `check` on every push and PR, and also runs `eval:check`.
- The "every eval has a pass recorded against its current inputs" assertion leaves the test suite and becomes the `eval:check` script. `/implement` runs it before opening a PR.

### 01 Dump document

- The existing Dump-writing module becomes the Dump document's owner: filename (stamp, label, slug), frontmatter (`session:`, `through:`, tags), origin line and the hand-off to the body parser, in both directions.
- It also owns the origin and coverage rules currently in `write-dump`'s argument parsing (`--swept` needs `--session`, swept is never chat, `--through` needs `--session`). `write-dump` and the Sweep both build Dumps through it.
- The origin module keeps only the tool table and git detection (`detectDevOrigin`, `projectOf`).
- The Inbox module keeps folder listing and reads Dumps through the Dump module. The body parser stays as an internal seam.
- Parsing returns the Dump or a named problem; `check` reports the problem, other readers raise it. `check`'s own header check goes away.
- **Project** means the origin-line link; it may be absent on a chat Dump. The filename segment is the **label**: a dev Dump's Project, a chat Dump's tool name (as today, even when the chat names a Project). `list-dumps` returns both `project` (nullable) and `label`.
- The file skill matches Routes on `project`, falling back to `label`. The link line's alias uses `label`.
- Filenames don't change.
- GLOSSARY gains **Project**: "The repo or subject a Session was about; for a dev Session, its main worktree folder; for a chat Session, given or absent."
- ADR 0010, "Pure format modules are tested at their own interface", records the testing decision below.

### 02 Filed-Item lines

- A filed Item in the Filing Plan carries index, outcome, note, optional section and group, optional route, and optional `text` (edited wording only). It carries no `lines`.
- The plan has no `inserts`. The helper adds the link line, `- Filed [[<title>|<label> <slug>]]` under `# Notes:` in the Session's week, when the plan finishes the Dump and at least one Item is filed now or in an earlier Run. A NEW Weekly Note for it still goes in `creates`.
- The helper renders each Item from the stored Item and its destination: Todo `- [ ] <text> #todo` (the `#todo` moved to the end, also for edited text); Learning `- <text>` plus `From`; Decision `- <text>`, `Why:` and `From`.
- The curated-note module gains the writing side, next to its existing `From`, `Why` and `Filed` parsers and `itemKey`. Digest, `check`, Recall and duplicates keep importing it.
- `apply --dry-run` validates the plan and returns every Item's rendered lines plus the link line (and whether it is due), writing nothing. The skill's table "As" column and `show N` use it.
- Hard switch in one ticket: the plan schema rejects `lines` and `inserts`; the file skill, the File eval and the tests change together.

### 03 Session log adapters

- The Claude Code and Codex log modules each gain a fixture writer next to their reader. The Codex writer emits the current `item_completed` format only; the pre-0.147 `event_msg` format stays covered by one frozen fixture file.
- The transcript module owns the Session text form `[YYYY-MM-DD HH:MM] User:` in both directions, in local time. The Sweep and the evals use it.
- Sweep tests and evals build logs through the adapters.
- Eval fixture Sessions stay in the real Claude Code projects folder, since a separate config folder loses the login. They are written only through the adapter, into folders with a recognisable prefix, removed in `finally`, and any prefixed leftovers are removed when an eval starts.

### 04 Drafting agent

- A new drafting module owns the pinned model, the tool-less `claude -p` spawn (ADR 0009), the Sweep reply contract (`Slug:` plus body, or `No Items`), and the text cap. Its interface takes a Session's text and returns a prepared Dump, `no-items` or `off-contract`.
- The Sweep keeps candidate windowing, the ledger, retry and the lock, and calls the drafting module.
- The chat-dump paste contract (one fenced block) stays with chat-dump: in production the agent running the skill handles a paste, not the helper.
- The rubric's grader runs through the evals' own runner. Nothing in the evals imports the Sweep.
- The existing drafting-agent override variable stays the test seam.

### 05 Eval inputs

- An eval's code inputs are computed by walking relative imports with Bun's transpiler `scanImports`, ignoring type-only imports, since they can't change behaviour.
- The dump, chat-dump and file evals start from the CLI entry point; the Sweep eval starts from the drafting module.
- Each eval declares by hand only what imports can't reach: skill prose, prompts read at runtime, fixtures.

### 06 Vault Items (conditional)

- First step: re-check whether, after 01 and 02, Recall, `check`, duplicates and the pointer still each join Dumps to filed Items themselves. If not, close the ticket with that finding.
- If so: one module returns every Item in the allowlist with its state, source Dump and identity (`itemKey`), and those four ask it. The pointer reads the Vault once.

### 07 Guard matchers

- `brain-dump guard --matchers claude|codex` prints the hook matcher for that agent, derived from the guard's own tool lists.
- The installer calls it after putting `brain-dump` on the PATH; its guard descriptions become generic ("the file and shell tools"). No tool name remains in the installer.

### 08 Glossary check

- A script reads every `_Avoid_:` term from GLOSSARY and fails when one appears in skills, prompts, README, specs, or string literals in the helper's source. GLOSSARY itself, ADRs and code identifiers are excluded.
- `check` runs it.

## Testing Decisions

- A good test drives behaviour through an interface and asserts what a caller observes; it survives internal refactors. Tests of the old shallow modules that the new interfaces replace are deleted, not kept alongside.
- **Behaviour stays tested at the `brain-dump` commands** (ADR 0002): `write-dump`, `list-dumps`, `apply` (including `--dry-run`), `sweep`, `recall`, `check`, `guard --matchers`, against the fixture Vault in the test harness.
- **Pure format modules are also tested at their own interface**: the Dump document, filed-Item lines, the Session log adapters and the text form, each with render-then-parse round trips across their variants (dev and chat origins, with and without Project, swept, covered Sessions; Learning, Decision, Todo, edited text; both Codex formats). Prior art: the append-only check and the shared Item rules are already tested directly.
- Drafting is tested through the Sweep at the CLI with the existing shell-stub agent, as the Sweep tests do today.
- Eval input derivation is tested with the existing eval tests: the hash changes when a reached module changes, not when an unreached one does, and declared prose still counts.
- The Glossary check is tested against a small fixture tree.
- Tickets that change hashed inputs rerun the affected real-model evals and record passes before their PR; `eval:check` enforces it.

## Out of Scope

- Any change to Filing, Sweep, Recall or Consolidation behaviour beyond the three visible changes above.
- Editing a Decision's Rationale in `edit N`.
- Renaming existing Dump files.
- Isolating evals from the real Claude Code config folder through `claude setup-token` or an API key.
- A coding-standards document, and changes to the user's global agent instructions.
- Revisiting ADRs 0003, 0005, 0006, 0007 and 0009.

## Further Notes

- Comes from the architecture review and build retro of 2026-10-12, run after the v2 build (#55).
- Build one ticket at a time with `/implement`, clearing context between tickets.
- 02 and 04 change skill prose or drafting inputs and need real-model eval reruns.
