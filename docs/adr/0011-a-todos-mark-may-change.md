# A Todo's checkbox mark is the one thing in a Curated Note that may change

Todos are filed as `- [ ]` checkboxes in a Weekly Note's to-do section, and ticking them off is the point. Under ADR 0003 nothing in a Curated Note may be rewritten, so the helper could add Todos but never close one; agents and homeros would have to leave the Vault stale or edit it behind the gateway.

Append-only stays absolute for text. The single exception is the mark inside a Todo's checkbox in any Weekly Note's to-do section, which may change between ` ` (open), `x` (done) and `-` (dropped), in any direction. The gateway checks this as its own mode over (original, next): same line count, every line byte-for-byte identical except the named Todo lines, and on those only the mark character differs. Each marking is one Run, so `undo` restores it exactly (ADR 0006).

Rewording, moving or carrying Todos to another week stay out: each is a rewrite or a delete, and would weaken the line-survives check this exception leaves almost intact.

## Considered Options

- **Record completion by appending** (e.g. a "Done:" line): keeps ADR 0003 untouched, but the checkbox stays `[ ]`, so Obsidian, `todos` and every reader show a finished Todo as open.
- **Let the helper rewrite Todo lines freely** (marks, text, position): covers rewording and carry-over too, but turns the gateway's hard check into "the diff matches the request" for Curated Notes.
