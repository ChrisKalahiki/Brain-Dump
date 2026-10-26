---
name: todo
description: 'Mark the user''s Todos in their Weekly Notes done, dropped or open again, after a yes, or list what is still open. Use when the user asks to mark, finish or drop a Todo, asks what is on their plate this week, or says in passing they finished something that may be a Todo ("I sent the draft to Ana"). Not at the end of a Session; `dump` covers that.'
allowed-tools: Bash(brain-dump:*)
---

Mark **Todos** in the user's Weekly Notes through the `brain-dump` helper, which does every read and write. Never read or write the Vault with your own file tools. Vocabulary (Vault, Todo, Todo Group, Weekly Note) follows the Brain-Dump glossary: a Todo is open, done or dropped, and changing which is **marking** it.

Nothing is marked without the user's yes to the exact Todos shown.

## 1. Read the Todos

Run `brain-dump todos --date <today, YYYY-MM-DD>`. It prints `{note, exists, hash, todos}`: this week's Weekly Note, its `hash`, and each Todo's `text`, `state` (`open`, `done` or `dropped`), `groupPath` (outermost Todo Group first), `parentIndex` (its parent Todo's index in `todos`, or `null`) and 1-based `line`. `exists: false` means the week has no Weekly Note yet, so no Todos.

Read last week's too, with `--date` set to the same day a week ago, when the user names last week or no Todo this week matches.

When the user only asked what is open, list this week's open Todos by Todo Group and stop. Done.

Done when you hold the Todos, `note` and `hash` of every week you read.

## 2. Match what the user said

Match the user's words to Todos by sense, not exact wording ("the README thing" can be `Write the cache section of the README.`): open Todos, or done and dropped ones when the user wants one back.

- **One match per thing the user named**: propose it (step 3).
- **Several matches**: ask which, listing each candidate as a row with no state (step 3's row form, without `→ <state>`) under its note's title. Done for now; propose once the user picks.
- **No match**: say so, naming the notes you read. Done.

The state is `done` unless the user said they dropped, abandoned or no longer need it (`dropped`), or want it back (`open`).

## 3. Propose

Show the Todos to mark, grouped under each note's title in bold, one row each:

```
**10-05-26 Weekly Update**
- 7 · Dissertation › IRB · Finish the IRB application. → done
+ 8 · Dissertation › IRB · Upload the consent form. → done

Reply: ok · ok all · cancel
```

A row is `<line> · <group path> · <text> → <state>`, with the group path written `Dissertation › IRB` (`(ungrouped)` for none). Rows starting `-` are what the user asked for. When a Todo marked done or dropped has open sub-todos (Todos whose `parentIndex` chain leads to it), list each below it as a row starting `+`, with the same state: an offer, marked only on `ok all`. Then the replies: `ok` marks the `-` rows, `ok all` the `+` rows too, `cancel` marks nothing. Without `+` rows, offer `ok · cancel`.

Done when the proposal is on screen and nothing has been marked. Wait for the reply.

## 4. Mark

On `cancel`, mark nothing. Done. On `ok` or `ok all`, run one command per note, with the `hash` from that note's step 1 read:

```bash
brain-dump mark-todos --date <a date in that note's week> --hash <hash> --line <line>=<state> --line <line>=<state>
```

It prints `{run, note, hash, changed, unchanged}`.

- **Exit 0**: tell the user what was marked (`changed`), what already was in that state (`unchanged`), and the `run` id, which `brain-dump undo <run>` reverses. `run` is `null` when nothing changed.
- **`Marking stale: … changed since it was read`**: nothing was marked. Read again (step 1), match again, and show the new proposal headed `Re-proposed: <note> changed since you last saw it`. Wait for a fresh yes.
- **Anything else**: nothing was marked. Tell the user the reason.

Done when the user knows, for every note, what was marked or why nothing was.
