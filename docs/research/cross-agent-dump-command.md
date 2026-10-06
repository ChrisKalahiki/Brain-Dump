# Research: one `dump` command for Claude Code and Codex CLI

Answers [#3](https://github.com/ChrisKalahiki/Brain-Dump/issues/3): how can one `dump` command be written once, run in both Claude Code and Codex CLI with the current Session's context, and write a Dump into `~/Documents/The Vault/Inbox/`?

- Researched: 2026-10-05
- Local versions checked: Claude Code `2.1.289`, Codex CLI `0.159.0` (latest release is `0.160.1`, 2026-10-05)
- Sources: official docs, the `openai/codex` source at commit [`685270a`](https://github.com/openai/codex/tree/685270a56a96c76ae5b0853373a19d6ed5bc6fd4) (2026-10-05), Codex release notes, and the agentskills.io spec. All were read on 2026-10-05.

## Bottom line

1. **Both tools now run the same `SKILL.md` format** (the [Agent Skills](https://agentskills.io/specification) open standard). A skill is a folder with a `SKILL.md` file: YAML frontmatter with `name` and `description`, then Markdown instructions. The tools read it from different folders, so one source needs a symlink, a plugin, or a copy step.
2. **A skill sees the Session's context in both tools.** It runs in the current conversation by default. The model sees the whole live context, except for anything already compacted away.
3. **Codex custom prompts (`~/.codex/prompts`) are gone.** They were deprecated in 0.117.0 and removed in 0.118.0 (2026-03-31). Skills are the only Codex mechanism left.
4. **Writing to the Vault is outside the workspace in both tools.** By default each tool asks for approval for that write. Both can be set up to allow `…/The Vault/Inbox` without prompting.
5. **The user's machine already has a working single-source layout.** `~/.agents/skills/<name>` is the canonical copy, and `~/.claude/skills/<name>` is a symlink to it. Codex reads `~/.agents/skills` natively.

## 1. Claude Code

### Skills and slash commands
Source: [Skills docs](https://code.claude.com/docs/en/skills).

- **Commands are now skills.** "Custom commands have been merged into skills." `.claude/commands/dump.md` and `.claude/skills/dump/SKILL.md` both create `/dump`. Skills are preferred because they support supporting files, frontmatter controls, and model invocation.
- **Locations, in precedence order:**
  1. Enterprise (managed)
  2. Personal: `~/.claude/skills/<name>/SKILL.md`
  3. Project: `.claude/skills/<name>/SKILL.md`, and nested `<subdir>/.claude/skills/`
  4. `--add-dir` directories
  5. Plugins, namespaced as `/plugin:skill`

  For a command that should work "in any repo", the personal location is the one that matters.
- **Claude Code does not read `~/.agents/skills`.** The memory docs list "anything under a `.agents/` directory" as not read ([memory docs](https://code.claude.com/docs/en/memory)). A symlink is needed.
- **Symlinked skill folders work.** On this machine (2.1.289), `~/.claude/skills/research` → `../../.agents/skills/research` and the other symlinked skills load and run. This is local evidence; I did not find a documented guarantee.
- **Invocation:** `/dump [args]`, or the model invokes it automatically when the request matches `description`. `disable-model-invocation: true` limits it to manual use.
- **Claude-only features in a skill body:**
  - `$ARGUMENTS`, `$0`, and named `arguments`
  - `${CLAUDE_SESSION_ID}`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PROJECT_DIR}`
  - `` !`cmd` `` shell pre-rendering
  - `allowed-tools`, `context: fork`, and `model`

  Non-standard frontmatter is accepted by Claude Code. It is rejected only when a skill is uploaded to the claude.ai/API Skills surface.

### How a skill sees the Session
- **Default is inline.** The skill "runs in your current conversation context … Full conversation history available to Claude." The skill text is added to the conversation as one message.
- **`context: fork` must not be used for `dump`.** A forked subagent "doesn't see your conversation history."
- **Compaction loses detail.** After auto-compaction the model sees only the summary of earlier turns. A `dump` after a long Session can therefore miss details that were compacted.

### Plugins
Source: [plugins overview](https://code.claude.com/docs/en/plugins).

- A plugin is a directory with `.claude-plugin/plugin.json`, plus `skills/`, `agents/`, `hooks/`, and `.mcp.json`.
- A marketplace is a repo with `.claude-plugin/marketplace.json`. Install with `/plugin marketplace add owner/repo`, then `/plugin install name@marketplace`.
- Plugin skills are namespaced: `/brain-dump:dump`, not `/dump`.
- Scopes are user, project, or local.

## 2. Codex CLI

### Skills
Sources: [Codex skills docs](https://learn.chatgpt.com/docs/build-skills) (redirected from `developers.openai.com/codex/skills`) and source [`ext/skills/src/host_roots.rs`](https://github.com/openai/codex/blob/685270a56a96c76ae5b0853373a19d6ed5bc6fd4/codex-rs/ext/skills/src/host_roots.rs).

- **Locations:**
  - REPO: `.agents/skills` in each directory from the project root down to `$CWD`, and `.codex/skills` in the project config layer
  - USER: `$HOME/.agents/skills`, plus the deprecated `$CODEX_HOME/skills` (`~/.codex/skills`), which is "kept for backward compatibility"
  - ADMIN: `/etc/codex/skills`
  - SYSTEM: bundled skills
- **History:** `.agents/skills` support arrived in 0.94.0 ([#10317](https://github.com/openai/codex/pull/10317)). `~/.agents/skills` arrived in 0.95.0 (2026-02-04, [#10437](https://github.com/openai/codex/pull/10437)).
- **Symlinks:** the docs say Codex "follows the symlink target when scanning these locations."
- **Format:** `SKILL.md` with required `description` and `name` (at most 64 characters; it defaults to the folder name). Unknown frontmatter keys are ignored: the parser does not use `deny_unknown_fields` ([`skills/src/parser.rs`](https://github.com/openai/codex/blob/685270a56a96c76ae5b0853373a19d6ed5bc6fd4/codex-rs/skills/src/parser.rs)). Claude-only keys therefore do no harm.
- **Optional `agents/openai.yaml`:** holds UI metadata and `policy.allow_implicit_invocation` (default `true`). Set it to `false` to require explicit `$dump`.
- **Invocation:** type `$dump` in the prompt, or pick from `/skills`. Codex can also invoke a skill implicitly when the request matches `description`. Typing `@` opens a unified mentions menu (0.140.0).
- **No preprocessing:** Codex does not substitute `$ARGUMENTS` or run `` !`cmd` ``. Text typed after `$dump` is just part of the user's message.
- **Config:** `[[skills.config]]` entries in `~/.codex/config.toml` (`path` or `name`, plus `enabled`) turn skills on and off. Restart Codex after changes.

### How a skill sees the Session
- The selected skill's `SKILL.md` is added to the current thread as a user-role `<skill>` fragment ([`ext/skills/src/fragments.rs`](https://github.com/openai/codex/blob/685270a56a96c76ae5b0853373a19d6ed5bc6fd4/codex-rs/ext/skills/src/fragments.rs)). As in Claude Code, the model sees the live thread, including any compaction.

### Custom prompts (removed)
- `~/.codex/prompts/*.md` invoked as `/prompts:name` was deprecated in 0.117.0 ([#15076](https://github.com/openai/codex/pull/15076)). It was removed in 0.118.0, 2026-03-31 ([#16115](https://github.com/openai/codex/pull/16115), "Remove remaining custom prompt support").
- The installed 0.159.0 binary has no `/prompts:` string.
- The [custom prompts docs page](https://learn.chatgpt.com/docs/custom-prompts) still describes the feature but labels it "deprecated in favor of skills". Do not build on it.

### AGENTS.md
- Codex loads `~/.codex/AGENTS.md` (or `AGENTS.override.md`), then the `AGENTS.md` files from the repo root down to the cwd.
- `project_doc_fallback_filenames` defaults to empty ([`config/src/config_toml.rs`](https://github.com/openai/codex/blob/685270a56a96c76ae5b0853373a19d6ed5bc6fd4/codex-rs/config/src/config_toml.rs)).
- Claude Code 2.1.277+ reads a repo `AGENTS.md` only when no `CLAUDE.md` exists ([memory docs](https://code.claude.com/docs/en/memory)).
- For `dump`, AGENTS.md is a fallback at most, an always-loaded "when I say dump, do X" rule. It is not a command, and it costs context on every turn.

### Plugins (cross-compatible)
- Codex 0.146.0 (2026-07-29) added "Agent Plugins manifests … and additional plugin marketplaces for … Claude Code" ([release notes](https://github.com/openai/codex/releases/tag/rust-v0.146.0)).
- Source evidence:
  - Codex looks for plugin manifests at `.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`, or `.cursor-plugin/plugin.json` ([`exec-server-protocol/src/protocol.rs`](https://github.com/openai/codex/blob/685270a56a96c76ae5b0853373a19d6ed5bc6fd4/codex-rs/exec-server-protocol/src/protocol.rs)).
  - It looks for marketplaces at `.agents/plugins/marketplace.json` or `.claude-plugin/marketplace.json` ([`core-plugins/src/marketplace.rs`](https://github.com/openai/codex/blob/685270a56a96c76ae5b0853373a19d6ed5bc6fd4/codex-rs/core-plugins/src/marketplace.rs)).
  - The installed 0.159.0 binary contains `.claude-plugin/plugin.json`.
- Install with `codex plugin marketplace add …`, then `codex plugin add …`.

### Import from Claude Code
- Codex `/import` (0.140.0, 2026-06-15; extended in 0.145.0) copies Claude Code skills, commands, AGENTS/CLAUDE.md, and MCP config into Codex locations ([`external-agent-migration/src/service.rs`](https://github.com/openai/codex/blob/685270a56a96c76ae5b0853373a19d6ed5bc6fd4/codex-rs/external-agent-migration/src/service.rs)).
- It is a one-time **copy** that rewrites Claude-specific terms, so the two copies drift afterwards. It does not give a single source.

## 3. Writing into the Vault (an absolute path outside the repo)

The target is `~/Documents/The Vault/Inbox/`. It contains a space, so shell commands must quote it.

### Claude Code
Sources: [permissions](https://code.claude.com/docs/en/permissions) and [sandboxing](https://code.claude.com/docs/en/sandboxing).

- **Default:** a Write/Edit-tool write prompts in Manual mode. `acceptEdits` auto-accepts only "paths in the working directory or `additionalDirectories`", so a Vault write still prompts.
- **Ways to stop the prompt:**
  1. **Allow rule** in `~/.claude/settings.json`: `"permissions": {"allow": ["Edit(~/Documents/The Vault/Inbox/**)"]}`.
     - `Edit` rules cover all file-editing tools.
     - A `Write(...)` rule is accepted but never consulted.
     - Use `~/` or `//abs/path`. A single leading `/` is relative to the settings file.
     - The narrowest option is to grant only `Inbox/`.
  2. **Skill `allowed-tools`**, for example `Edit(~/Documents/The Vault/Inbox/**)`. This pre-approves only "during this skill's turn", which keeps the grant inside `dump`. **Unverified:** whether a path containing a space parses correctly in `allowed-tools`. Test it.
  3. **`permissions.additionalDirectories`** or `--add-dir`. This also gives read access to the whole Vault and turns on `acceptEdits` there. It is broader than needed.
- **Bash writes** (`cat > …`, `tee`) check redirect targets against the same `Edit` rules. If the optional Bash sandbox is on, it also needs `sandbox.filesystem.allowWrite` for the Vault path. The sandbox is off by default.

### Codex CLI
Sources: [agent approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security), [sandboxing](https://learn.chatgpt.com/docs/sandboxing.md), and `SandboxPolicy::get_writable_roots_with_cwd` in [`protocol/src/protocol.rs`](https://github.com/openai/codex/blob/685270a56a96c76ae5b0853373a19d6ed5bc6fd4/codex-rs/protocol/src/protocol.rs).

- **Defaults:**
  - Trusted git repos run `workspace-write` with approval `on-request`.
  - Writable roots are the cwd, `/tmp`, and `$TMPDIR`, plus configured `writable_roots`.
  - Network is off.
  - `.git`, `.codex`, and `.agents` inside the workspace stay read-only.
- **Without config:** the Vault write triggers an approval prompt under `on-request`. Under `never` it fails.
- **Ways to stop the prompt:**
  1. `~/.codex/config.toml`: `[sandbox_workspace_write]` `writable_roots = ["~/Documents/The Vault/Inbox"]`. `~/` is expanded ([`utils/absolute-path/src/lib.rs`](https://github.com/openai/codex/blob/685270a56a96c76ae5b0853373a19d6ed5bc6fd4/codex-rs/utils/absolute-path/src/lib.rs)). This is global, so every Codex session can write there.
  2. `codex --add-dir "~/Documents/The Vault/Inbox"` for each run, for example through a shell alias.
  3. Named permission profiles (`default_permissions = "…"`, `[permissions.<name>.filesystem]`, which maps paths to `read`/`write`/`deny`). These are more granular, and the schema is still changing between releases ([`config/src/permissions_toml.rs`](https://github.com/openai/codex/blob/685270a56a96c76ae5b0853373a19d6ed5bc6fd4/codex-rs/config/src/permissions_toml.rs)). Check the docs before relying on them.
- **No per-skill approval:** a Codex skill cannot grant itself write access. `allowed-tools` is not honored. The grant always comes from config or flags.

## 4. Linux vs macOS

| Topic | Linux | macOS |
|---|---|---|
| Codex sandbox | bubblewrap. Uses `bwrap` from `PATH`, otherwise a bundled copy, with a warning ([linux-sandbox README](https://github.com/openai/codex/blob/685270a56a96c76ae5b0853373a19d6ed5bc6fd4/codex-rs/linux-sandbox/README.md)) | Seatbelt (`sandbox-exec`) |
| Claude Code Bash sandbox (optional) | Needs `bubblewrap` and `socat` installed. On Ubuntu 24.04+, AppArmor blocks user namespaces until allowed | Seatbelt, built in |
| `~/Documents` access | Plain directory | **TCC-protected.** The terminal app (and, for Claude Code, background sessions) must be granted Documents access, or writes fail with `Operation not permitted` ([permissions docs](https://code.claude.com/docs/en/permissions#working-directories)) |
| Default writable temp | `/tmp` (Codex) | `/tmp` plus per-user `$TMPDIR` (Codex) |
| Symlinks for skills | Work | Work. Prefer relative links (`../../.agents/skills/dump`) so a dotfiles repo stays portable |
| Helper scripts | GNU `date`, `sed -i` | BSD `date`, `sed -i ''`. A shell helper must avoid GNU-only flags, or be written in a portable language |
| Filenames | Case-sensitive | Case-insensitive by default (APFS). Avoid Dump filenames that differ only by case |

The Vault path is assumed to be the same on both OSes. If the Vault is synced through iCloud/Obsidian Sync to a different location on one machine, make the path a single config value rather than hard-coding it.

## 5. Authoring one source for both tools

All options assume the skill body uses only portable features:
- frontmatter `name` and `description`
- plain-English instructions
- the Session context the model already has
- an optional helper script under `scripts/`

Avoid relying on `$ARGUMENTS` and `` !`cmd` ``, or make the text read sensibly without them. Codex ignores extra Claude-only frontmatter, so `disable-model-invocation: true` can stay.

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. Canonical `~/.agents/skills/dump` + symlink** | Real folder in `~/.agents/skills/dump`, then `ln -s ../../.agents/skills/dump ~/.claude/skills/dump` | Already the user's pattern for about 30 skills. Codex reads it natively. Zero build step. `/dump` and `$dump` are both short | Install is per machine (two dotfile steps). Symlink support in Claude Code is observed, not documented. The source lives outside this repo unless the repo is symlinked in |
| **B. Repo as the source, symlinked into both** | Keep `skills/dump/` in Brain-Dump and run `ln -s <repo>/skills/dump ~/.agents/skills/dump` (and into `~/.claude/skills`). A tiny `install.sh` can do it | Versioned with the project. `git pull` updates both tools | Absolute symlinks into a checkout break if the repo moves. Needs an install script that works on both OSes |
| **C. Plugin + marketplace in this repo** | `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `skills/dump/SKILL.md`. Install with `/plugin marketplace add ChrisKalahiki/Brain-Dump` in Claude Code and `codex plugin marketplace add …` in Codex | One distributable artifact for both tools, with versioned updates. `file` and future commands ship together | Command becomes `/brain-dump:dump` (namespaced). Codex's Claude-plugin compatibility is new (0.146.0, July 2026) and less proven. Plugin skills add context cost every turn. More moving parts for one user |
| **D. Generator** | Build per-tool files (`SKILL.md` and `agents/openai.yaml`) from one template | Can emit tool-specific extras (Claude `allowed-tools`, Codex `allow_implicit_invocation: false`) | A build step for what is mostly one Markdown file. Only worth it if the per-tool content diverges a lot |
| **E. Codex `/import` copy** | Author for Claude Code, import into Codex | No setup | Copies drift. Rewrites terms. Not a single source |

For the Vault write in every option:
- **Claude Code:** grant via an `Edit(~/Documents/The Vault/Inbox/**)` allow rule, or via the skill's `allowed-tools`.
- **Codex:** grant via `writable_roots` or `--add-dir`.
- **Fallback:** accept one approval prompt per `dump`.

The skill should write one new file per Dump: create, never overwrite. That keeps a prompted write cheap to review.

### Tentative recommendation (the user decides)
**B now, C later if needed.**
- Keep `skills/dump/SKILL.md` (and later `skills/file/`) in this repo as the single source.
- Ship a small portable `install.sh` that symlinks it into `~/.agents/skills/` (Codex) and `~/.claude/skills/` (Claude Code), and prints the two one-line permission snippets above.
- This matches the user's existing layout, gives the unprefixed `/dump` and `$dump`, and keeps the source versioned here.
- Moving to a plugin (C) stays open once there are several commands or other users. The same `skills/` folder works as plugin content unchanged.

## Open questions / unverified
- Does Claude Code's `allowed-tools` parse a path with a space (`The Vault`)? If not, use a settings allow rule or quote/escape the path.
- Should `dump` be manual-only? That means `disable-model-invocation: true` for Claude and `allow_implicit_invocation: false` for Codex. Implicit invocation could write Dumps the user didn't ask for.
- After compaction, should `dump` also read the raw transcript? Claude Code exposes `${CLAUDE_SESSION_ID}`. Codex exposes `CODEX_THREAD_ID` in the shell environment ([`protocol/src/shell_environment.rs`](https://github.com/openai/codex/blob/685270a56a96c76ae5b0853373a19d6ed5bc6fd4/codex-rs/protocol/src/shell_environment.rs)). However, Codex storage is moving to SQLite (`codex migrate-rollouts`), and ADR-0001 rejects transcript parsing. The tentative default is live context only.
- Is the Vault at the same path on the macOS machine?
