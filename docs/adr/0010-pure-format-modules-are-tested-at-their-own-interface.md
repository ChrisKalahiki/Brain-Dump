# Pure format modules are tested at their own interface

ADR 0002 makes the `brain-dump` commands the test seam: behaviour is tested by running a command against a fixture Vault. That stays. A module that only turns a format into text and back (the Dump document, filed-Item lines, the Session log adapters, the Session text form) is also tested directly, with render-then-parse round trips across its variants: what it writes is provably what it reads. A command-level test can't show that, because it sees one direction at a time and only the variants a command happens to produce.

These modules read and write no files, so testing them directly couples nothing to internals: their interface is the format. The append-only check and the shared Item rules were already tested this way.

## Consequences

- A round-trip test of a format module is not a breach of ADR 0002; reviewers shouldn't flag it.
- Behaviour that touches the Vault, the CLI's output or exit codes is still tested at the commands.
- Tests and evals build their fixtures through these modules rather than hand-writing the format, so a format change is one edit.
