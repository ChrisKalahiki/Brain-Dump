# Undo restores exactly; it is the only removal append-only allows

ADR 0003 keeps append-only absolute, but undoing a Run has to take out the lines that Run appended. The write gateway (ADR 0005) gains a fourth mode, **Revert**: a file may be reverted only while it is still byte-identical to what the Run left, and the result must equal the snapshot taken before the Run, byte-for-byte (a file the Run created is deleted; a moved file moves back). The only text that can ever disappear is text Brain-Dump itself wrote in that Run, untouched since.

Before replacing any file, the gateway journals each Run outside the synced Vault, in a per-machine store (`~/.local/state/brain-dump/runs/`), with a copy of every existing file it touches. Undo reverts a whole Run or nothing, is dry-run by default with `--confirm` to apply, and is itself a Run, so it can be undone. If any file changed after the Run, whether locally, through a later Run, or via Sync from another machine, undo refuses and names the files.

## Considered Options

- **Surgical revert** (remove just the Run's inserted lines even after later edits): more forgiving, but the check becomes "exactly these lines vanished", the diff-matching ADR 0003 rejected.
- **No-removal undo** (only untick checkboxes and move the Dump back; appended lines stay): keeps ADR 0003 literal, but leaves the user to clean curated notes by hand, which is the failure undo exists to fix.
- **A synced run store**, so either machine can undo: snapshots would travel through Sync, the channel being guarded against. Multi-machine use is rare.
- **A git repo over the Vault**: out of scope for v2; snapshots cover undo without managing a repo inside a synced folder.
