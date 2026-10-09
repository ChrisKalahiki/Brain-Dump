# Every Vault write goes through one gateway that checks the result

Append-only used to hold only because the Filing code was written that way; a bug in section-finding or Todo Group insertion could overwrite lines and nothing would notice. Every file write the `brain-dump` helper makes to the Vault now goes through one module, and nothing else in the helper writes, renames or deletes Vault files.

The gateway enforces every rule about what may be written:

- **Path**: only inside the allowlisted folder trees (ADR 0004).
- **Size**: a plan writing more than 8 notes needs a separate confirmation (ADR 0004).
- **Mode**, one per file:
  - **Create-new**: a new file never overwrites an existing one.
  - **Append-only**, for existing notes: every original line appears in the new version byte-for-byte and in order; new lines may land anywhere; only an empty placeholder bullet (`- ` or `- [ ]`) may disappear. Line endings match the original.
  - **Checkbox-only**, for a Dump being filed: same line count, every line identical except the planned Items, whose checkbox may change only from ` ` to `x` or `-`. Moving it to `Inbox/Filed` requires the destination not to exist and the moved contents to be the ones just verified.

The check is a separate pure function over (original, next), deliberately sharing no code with the edit logic, so it can't share its bugs. It runs after all edits are staged and before any file is replaced, comparing against each file re-read from disk at that moment. If any file fails, nothing is written, and the error names the note and first lost line as a `brain-dump` bug. There is no override flag.

## Considered Options

- **Assertions inside the edit logic**: cheaper, but a check sharing code with what it checks repeats the same mistakes.
- **Per-command checks**: each new v2 writer (Consolidation, the capture sweep) would bring its own, and the safety argument would mean auditing every command instead of reading one module.
