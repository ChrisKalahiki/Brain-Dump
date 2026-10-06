# A `brain-dump` helper CLI owns every Vault read and write

The skills (`dump`, `file`) do the judgment work: summarising a Session into Items, and proposing destinations and Routes. All mechanical Vault work goes through a small Bun/TypeScript CLI, `brain-dump`, whose commands are the project's single test seam (`bun test` against a fixture Vault). That work is:

- resolving and validating the Vault
- building filenames and writing Dumps
- finding Weekly Notes
- applying an approved Filing Plan: placeholder fill, inserting before a section's `---`, backlinks, ticking Items, moving finished Dumps

This supersedes the v1 choice in [How does dump find The Vault from any repo on Linux and macOS?](https://github.com/ChrisKalahiki/Brain-Dump/issues/5) to have the agent write files with its own tools. Filing's insertion rules are exactly what free-form LLM edits get subtly wrong, and as prose they can't be tested.

## Consequences

- **Claude Code permissions:** the skills grant `Bash(brain-dump:*)` instead of `Edit(<Vault path>)`. The Vault path, which contains a space, never appears in a permission rule.
- **Codex:** the helper's writes outside the workspace still go through Codex's approval prompt.
- **Install:** Bun is required on each machine, and `install.sh` also puts `brain-dump` on the PATH.
