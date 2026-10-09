# Append-only stays absolute; Consolidation works by addition

Topic Notes and Project Notes only grow, so long notes become stacks of bullets nothing distils. v2 answers this with Consolidation: a Digest added to the note (or as a new note) that links back to the Items it distils. Nothing in a curated note is ever removed or rewritten, by Consolidation or anything else.

Keeping append-only absolute is what makes the safety layer simple and strong: `apply` can verify that every original line survives, in order, and refuse otherwise. A rewrite power would turn that hard check into "the diff matches the approved plan", which is much weaker, and would make snapshots and `undo` the only defence against lost text.

## Considered Options

- **Rewrite in place** (remove or merge the original bullets after approval): shorter notes on disk, but it gives the agent delete power over curated text and weakens the invariant the safety layer is built on.
- **Addition now, rewrite later in v2**: deferred, not rejected. A rewrite operation, if ever wanted, is a separate effort with snapshots and `undo` as hard prerequisites.
