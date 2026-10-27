# Briefings are a second place automation may create files

paper-bot writes Daily and Weekly Briefings into the Vault on a schedule, and Chris reads them without approving each one, so they cannot go through a Filing Plan. This narrows ADR 0004 and ADR 0005: `Research/Briefings` joins the allowlist as a second automation zone, where a dedicated Briefing writer (a gateway actor of its own, not "automation" or "approved-plan") may only create new notes. It never edits, renames or overwrites one, so append-only (ADR 0003) holds there as everywhere. A Briefing is not a Curated Note, and Brain-Dump treats its content as opaque Markdown that paper-bot owns: the gateway checks path, size and secrets, not format.

Briefings stay out of Filing destinations (`list-notes`), `recall`, `check` and the Vault pointer, so an unkept Pick never reads as filed knowledge. `show` can read them, which is how paper-bot finds the Picks Chris ticked as Keep. A Kept Pick still reaches a Topic Note only as a Dump in the Inbox, through normal Filing.

## Considered Options

- **Write Briefings as "approved-plan"**: no gateway change, but it would record an approval nobody gave.
- **Briefings as Dumps in the Inbox**: no carve-out, but a daily stream of papers would bury the Inbox and turn reading into Filing.
- **Keep the Briefing folder outside the allowlist with its own read and write path**: a clean separation, but it splits Vault IO across two tools, against ADR 0002, and `show` could not read Keeps.
- **Briefings recallable**: agents could find "the paper from Tuesday", but unkept Picks would pollute recall; Kept Picks become recallable once filed.

## Consequences

- A second Briefing for the same period is refused (create-new). A bad Briefing is fixed with `brain-dump undo <run>` and a re-run, which works only until Chris edits the note, for example by ticking a Keep (ADR 0006).
- `undo` is the one write under `Research/Briefings` not made by the Briefing writer: an approved revert restores exactly what a Run changed, so it cannot widen what a Briefing holds (ADR 0006).
- The glossary narrows Curated Note to notes outside the Inbox and `Research/Briefings`, and gains Briefing, Pick and Kept Pick.
