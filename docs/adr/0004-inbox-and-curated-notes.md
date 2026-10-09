# Automation only creates Dumps; Curated Notes change only through approved plans

The Vault splits in two. The Inbox is where automation may act without asking, but only by creating new Dump files: it never edits or overwrites an existing file, and never touches `Inbox/Filed` or the Routes note. Every Curated Note (anything outside the Inbox), plus `Inbox/Filed` and the Routes note, changes only through an approved plan applied by the `brain-dump` helper.

The helper itself writes only under an allowlist of folder trees, defined in code in the Vault layout module: `Inbox`, `Research/Main Notes`, `Research/Weekly Meetings`, `Side Projects`, `Resources`. A plan may create new notes and subfolders inside those trees. A plan writing more than 8 notes (excluding its Dump and the Routes note) is refused unless the user separately confirms it.

This is "automate where there's a test, gate where there isn't" as architecture: creating a new Dump can't destroy anything, so it needs no gate; everything else does.

## Considered Options

- **Automation may write anything in the Inbox**: lets a sweep tidy its own drafts, but it could also rewrite the Routes note that steers every later Filing.
- **A denylist of protected paths**: fewer config changes, but a forgotten folder is silently writable. With an allowlist, a missing folder fails safe with a clear error.
- **Allowlist in a Vault settings note or per-machine config**: editable without a code change, but an agent could widen its own write permissions by editing a note, and per-machine config drifts (Obsidian Sync also skips dot-files).
