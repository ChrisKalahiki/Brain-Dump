---
name: consolidate
description: Add a Digest to the end of a long Topic Note or Project Note, after the user approves its full text. Run as /consolidate [[Note]].
disable-model-invocation: true
allowed-tools: Bash(brain-dump:*)
---

Draft a **Digest** of the note the user named and, once they approve its full text, hand it to the `brain-dump` helper, which appends it. Never read or write the Vault with your own file tools. Vocabulary (Vault, Dump, Item, Learning, Decision, Rationale, Todo, Digest, Topic Note, Project Note, Weekly Note) follows the Brain-Dump glossary.

A Digest is a callout the helper adds at the end of the note. It distils the note's latest Digest plus everything after it, or the whole note when it has none, so the newest Digest alone describes the note. Nothing already in the note changes: Consolidation is append-only. One note per run, and only when the user asks.

If no note was named, ask which one. Done.

## 1. Read the note

Run `brain-dump show "<note>"` (a title, `[[Title]]` or path). It prints `{note, hash, text, truncated}`. `text` starts at the note's latest Digest, the `> [!summary] Digest MM-DD-YY` callout, or is the whole note when it has none. When `truncated` is true, run it again with `--full`. Keep `note` and `hash` for the plan.

Weekly Notes take no Digest: if `note` is in `Research/Weekly Meetings/`, say so and stop.

## 2. Draft the bullets

Write 3 to 10 one-line bullets, grouped by theme, covering the latest Digest and every Item and hand-written line after it:

- **Learnings**: merge ones that say the same thing; keep the specific fact, not a vague summary.
- **Decisions** that still hold: one bullet each, with a one-line Why, e.g. `Filing is append-only. Why: curated notes are never rewritten`.
- **Contradictions**: flag them, e.g. `Earlier: Bun for scripts; later: Node for the server`.
- **Open Todos**: leave them out; they live in Weekly Notes.
- **Links**: end each bullet with links to the Dumps its Items came from, as the Items' `From` lines give them: `[[<dump title>|dump MM-DD-YY]]`. Carry the previous Digest's links forward for what you keep from it. A bullet drawn from hand-written text (no `From` line) has no link and ends `(hand-added)`.

Bullets are plain text: no leading `- `, no line breaks. The helper adds the callout markup.

## 3. Show the plan

Preview it through the helper, which writes nothing without `--confirm`:

```bash
brain-dump consolidate "<note>" <<'PLAN'
expect:
  "<note>": "<hash>"
bullets:
  - "<bullet>"
  - "<bullet>"
  - "<bullet>"
PLAN
```

Write it exactly in this form, as block YAML: every string in double quotes (a `"` or `\` inside one escaped as `\"` or `\\`), one bullet per `- ` line, and no `{` anywhere in the plan, since Claude Code asks before running a command that holds both `{` and `"`. A bullet that needs a literal `{` can't keep that rule; send it anyway, and the user is asked once to approve the command.

It prints `{note, digest, supersedes, items, lines}`: the new Digest's ID, the ID of the Digest it supersedes (`null` for the first), how many filed Items it covers since that one, and `lines`, the full text exactly as it will be appended. Show the user:

- the target note, as `[[Title]]`;
- the Items covered: `items` filed Items, since `supersedes` or in the whole note;
- the Digest it supersedes, or "none";
- the full text, every line of `lines`, verbatim in a code block;
- the replies: `ok` · `edit` · `cancel`.

Done when the plan is on screen and nothing has been written.

## 4. Take the reply

- `edit`: the user either rewords the text themselves (use their wording for those bullets) or gives an instruction ("shorter", "split the Bun bullet"), and you re-draft. Preview again (step 3) and wait.
- `cancel`: write nothing. Done.
- `ok`: apply.

## 5. Apply

Run the same command with `--confirm`, adding the preview's `digest` to the plan, so the helper writes only the Digest the user saw:

```bash
brain-dump consolidate "<note>" --confirm <<'PLAN'
expect:
  "<note>": "<hash>"
bullets:
  - "<bullet>"
  - "<bullet>"
  - "<bullet>"
digest: "<the preview's digest>"
PLAN
```

- **Exit 0**: it prints the same report plus `run`, the Run's id. Tell the user the Digest was added, and that `/file` can take it back as "undo the last Consolidation".
- **`Consolidation plan stale: <note> changed since it was read`**: nothing was written; the note changed after you read it. Go back to step 1, re-draft from what's there now, and show the plan headed `Re-drafted: [[X]] changed since you last saw it`. Wait for a fresh `ok`; the earlier one no longer counts.
- **`Consolidation plan stale: the Digest would now be <id>, not <id>`**: nothing was written; the date turned over since the preview. Preview again (step 3) and wait for a fresh `ok`.
- **`… has no filed Item since …`** or **`… has no filed Item to consolidate`**: nothing new to digest. Tell the user. Done.
- **`invalid consolidation plan: …`**: your plan broke a rule (3 to 10 one-line bullets, none starting with `- `). Fix it, preview again, and wait for a fresh `ok`.
- Anything else: nothing was written. Tell the user the reason.
