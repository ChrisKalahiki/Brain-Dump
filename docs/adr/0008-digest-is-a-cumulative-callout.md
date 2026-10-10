# A Digest is a cumulative callout added at the end of its note

Consolidation adds a Digest to a Topic Note or Project Note (ADR 0003). The Digest is a `> [!summary] Digest MM-DD-YY` callout added at the end of the note and closed by a `^digest-MMDDYY` block ID on its own line (`-2`, `(2)` for a second on the same day). It covers everything above it by position: each Digest distils the previous Digest plus everything after it, so the latest one alone describes the whole note, and earlier Digests stay untouched. Its bullets link to the Dumps their Items came from, since Items carry no IDs of their own and adding a block ID to an existing line would break the append-only check (ADR 0005). `check` recognises the latest Digest as the last callout in the file and counts filed Items after its ID.

## Considered Options

- **A `## Digest` heading**: shows in the outline, but Filing keeps appending Items at the end of the note, so every later Item would read as part of the Digest. The callout closes cleanly.
- **A Digest at the top of the note**: easier to read first, but coverage can't come from position, so each Digest would have to record which Items it covers and `check` would have to parse that.
- **A separate Digest note**: keeps the source note clean, but adds files and makes `check` follow a link before it can count.
- **Incremental Digests** (each covering only the Items since the last): smaller drafts, but readers would have to stitch several Digests together.
