# What can a Claude Code PreToolUse hook inspect and block?

Research for #33 (map: #29, unblocks #34). Sources fetched 2026-10-09 from the official Claude Code docs. Claims are cited inline; anything not confirmed is marked **UNVERIFIED**.

Sources:
- [hooks] https://code.claude.com/docs/en/hooks
- [guide] https://code.claude.com/docs/en/hooks-guide
- [perms] https://code.claude.com/docs/en/permissions
- [tools] https://code.claude.com/docs/en/tools-reference
- [subagents] https://code.claude.com/docs/en/sub-agents

## 1. Input a PreToolUse hook receives

JSON on stdin. Common fields shown in the docs' Bash example [hooks]: `session_id`, `prompt_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `permission_mode`, `hook_event_name`, `tool_name`, `tool_input`, `tool_use_id`. `cwd` "follows the worktree and `cd` commands" [hooks]. `permission_mode` is one of `default`, `plan`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions` [hooks]. Inside subagents the input also carries `agent_id` and `agent_type` [hooks].

`tool_input` per tool:

| Tool | Fields | Source |
|---|---|---|
| Bash | `command`, `description` (opt), `timeout` (opt), `run_in_background` | [hooks] |
| Write | `file_path` ("Absolute path to the file to write"), `content` | [hooks] |
| Edit | `file_path` ("Absolute path to the file to edit"), `old_string`, `new_string`, `replace_all` | [hooks] |
| NotebookEdit | Path field is `notebook_path` [perms] (listed among each tool's "primary content field"). Edit modes `replace`/`insert`/`delete`, targeted by `cell_id`, `cell_type` [tools]. Full hook-input schema **UNVERIFIED** (not in the hooks reference sections fetched). | [perms], [tools] |
| MultiEdit | Described only as "the legacy `MultiEdit` tool" [perms]; absent from the current tools table [tools]. Its `tool_input` schema is **UNVERIFIED**. A guard can still list it in the matcher harmlessly. | [perms], [tools] |

Path normalisation: "For the file tools `Write`, `Edit`, and `Read`, `tool_input.file_path` is always absolute: Claude Code expands `~` and relative paths before hooks run, so a hook that matches on paths can't be bypassed via `~` or a relative spelling of the same path." [hooks] This statement names Write/Edit/Read only; whether `notebook_path` gets the same expansion is **UNVERIFIED**. Symlink resolution of `file_path` by the hook input is not mentioned in the hooks reference (**UNVERIFIED**), so a guard should not assume it is resolved.

## 2. How a hook blocks, and what the agent sees

- **Exit 2** = blocking error; the tool call is blocked and "Claude sees the stderr message as the denial reason" [hooks]. Exit 2 "stops the tool call before permission rules are evaluated, so the block applies even when an allow rule would otherwise let the call proceed" [perms]. The hook guide example does `echo "..." >&2; exit 2` [guide].
- **Exit 0 + JSON** on stdout:
  ```json
  {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}
  ```
  `permissionDecision` is `allow` | `deny` | `ask` | `defer`. For `deny`, `permissionDecisionReason` is "shown to Claude" [hooks]. Multiple hooks: precedence `deny` > `defer` > `ask` > `allow` [hooks].
- Choose one approach per hook (exit 2 or JSON), not both [guide].
- Exit 0 with no output = no decision; the call continues through normal permissions [hooks].
- **Other exit codes (including 1) are non-blocking errors**: the action proceeds [hooks], [guide]. A guard script that crashes therefore fails open. Likewise a timed-out command hook does not block (default timeout 600s) [hooks].
- `updatedInput` can rewrite tool args; permission rules are then evaluated against the rewritten input [hooks]. Not needed for a pure guard.
- A hook `allow` cannot override deny/ask rules in settings [hooks], [perms].
- Stdout must be only the JSON object; shell-profile output can break parsing [hooks].

## 3. Matchers

[hooks]:
- `"*"`, `""` or omitted: all tools.
- Only letters, digits, `_`, `-`, spaces, `,`, `|`: exact name or list, e.g. `Edit|Write`, `Edit, Write`.
- Anything else: JavaScript regex, unanchored (`Edit.*` also matches `NotebookEdit`; use `^Edit$`).
- MCP tools: `mcp__<server>__<tool>`.
- Optional `if` field takes one permission-rule string (e.g. `Bash(git *)`, `Edit(*.ts)`); it is documented as best-effort, and "use the permission system rather than a hook to enforce a hard allow or deny" [hooks]. For Bash, leading `VAR=value` assignments are stripped and each subcommand (including `$()` and backticks) is checked; if the commands can't be determined the hook runs anyway [hooks].
- Tool names are the exact strings from the tools reference [tools]. Relevant names: `Edit`, `Write`, `NotebookEdit`, `Bash`, and `PowerShell` (a separate shell tool, "see PowerShell tool for availability") [tools]. A Vault guard that matches only `Bash` would not see PowerShell; whether PowerShell is ever enabled on macOS is **UNVERIFIED**.
- Read/Grep/Glob are separate tools; PreToolUse fires "for every tool except `EndConversation`" [perms]. Whether the guard cares about reads is a #34 decision.

## 4. Install locations

[guide], [hooks]:

| Location | Scope |
|---|---|
| `~/.claude/settings.json` | all your projects, not shared |
| `.claude/settings.json` | one project, committable |
| `.claude/settings.local.json` | one project, gitignored |
| Managed policy settings | org-wide |
| Plugin `hooks/hooks.json` | while plugin enabled |
| Skill / subagent frontmatter | while that skill/subagent is active |

- Hook entries **merge** across levels; identical handlers run once [hooks].
- `"disableAllHooks": true` in settings turns hooks off (project settings can override user per precedence); managed hooks still run unless disabled from managed settings [guide].
- Project-level settings hooks are subject to workspace trust [hooks].
- Plugin subagents "don't support the `hooks`, `mcpServers`, or `permissionMode` frontmatter fields" [subagents].
- Script commands: prefer exec form (`command` + `args`) so paths are not shell-parsed; otherwise `command` runs via `sh -c` [hooks]. `${CLAUDE_PROJECT_DIR}` / `$CLAUDE_PROJECT_DIR` is the project root where the session started [hooks], [guide].
- Opt-in install for v2: any of user settings, project settings, or a plugin works; the docs impose no constraint among them beyond the above. Which is best is #34's call.

## 5. Subagents and permission modes

- **Subagents**: "a `PreToolUse` hook in `settings.json` also runs before every tool a subagent uses"; hooks from settings, managed policy and plugins all apply inside subagents [subagents].
- **All modes**: "`PreToolUse` hooks fire before any permission-mode check, in every permission mode, including `dontAsk`. A hook that returns `permissionDecision: "deny"` blocks the tool even in `bypassPermissions` mode or with `--dangerously-skip-permissions`." [guide]. In auto mode a hook `ask` forces a prompt and a hook deny is honored [hooks].
- Subagents inherit the parent's permission mode when it is bypass/acceptEdits/auto [subagents]; irrelevant to hook firing, which is mode-independent.
- Caveat: `claude -p` over an untrusted repo, or `disableAllHooks`, skips hooks [guide]. A user-level hook in `~/.claude/settings.json` can only be overridden by settings precedence (**exact precedence of `disableAllHooks` across scopes: UNVERIFIED**).

## 6. Gotchas for the Vault guard

**Paths with spaces**
- For Edit/Write, `file_path` arrives as a JSON string, so a space is just a character. Read it with `jq -r '.tool_input.file_path'` and always double-quote it in bash [guide example does quote `"$FILE_PATH"`/`"$CLAUDE_PROJECT_DIR"`]. The docs do not mention a space-specific bug (**no known issue found; absence of evidence only**).
- The `command` string for Bash is raw text; the Vault path will appear in it escaped or quoted in many forms (`"My Vault"`, `'My Vault'`, `My\ Vault`, `$'...'`). Substring matching on the unescaped path will miss escaped forms. Derived from shell semantics, not stated in the docs.
- Windows paths arrive with backslashes; normalise (not relevant on macOS) [hooks].

**Bash reaching the Vault indirectly**
The docs are explicit that command-text matching is not a boundary:
- Permission rules "match the command text Claude writes ... isn't a security boundary around the program": `Bash(rm *)` does not stop `/bin/rm`, `bash -c 'rm ...'`; `git -C . push` bypasses `Bash(git push *)` [perms].
- Argument constraints are "fragile": variables (`URL=... && curl $URL`), options reordering, redirects defeat patterns [perms]. The docs name PreToolUse hooks as the recommended alternative for inspecting full command text [perms], but that only helps with text the hook can see.
- Wrappers: `timeout`, `time`, `nice`, `nohup`, `stdbuf`, `command`, `builtin`, `noglob`, bare `xargs` are stripped before rule matching; `npx`, `docker exec`, `direnv exec`, etc. are not [perms]. This is for permission rules, but shows how many forms exist.
- A hook receives `cwd` (follows `cd`) [hooks], but a `cd "$VAULT" && ...` inside one command is just text; the hook does not receive the resulting directory. Compound commands, `$VAR`/`$(...)` expansion, globs (`cd My*`), `~` expansion, and symlinks are not resolved by Claude Code before the hook sees `command` (inferred from the input being the raw `command` string [hooks]; docs do not explicitly say "no expansion", so treat as **UNVERIFIED but safe assumption**).
- Scripts (`bun x.ts`, `python x.py`, `sh script.sh`) can open any path internally; the hook sees only the interpreter and script name, not paths opened inside the file. Inferred; not documented.
- Symlinks: the built-in permission system checks both the requested and resolved path for Read/Edit/Write (deny rules match either) and refuses Edit/Write on a path that is itself a symlink, but "a write can still pass through a symlink when a directory on the way to the file is a symlink, or when a Bash or PowerShell command does the writing" [perms]. Those protections are permission-rule behaviour; a custom hook gets the un-resolved `file_path` (see section 1) and must `realpath` it itself.
- Built-in read-only commands (`ls`, `cat`, `cd`, `grep`, `find`, ...) run without prompts in every mode [perms]; PreToolUse still fires for them [perms], so a hook can see them.
- Hard enforcement: the docs point to **sandboxing** for "filesystem and network enforcement that doesn't depend on the command text" [perms], with "defense-in-depth" using both [perms]. Sandbox covers Bash commands only [perms]; details of sandbox filesystem rules are outside this ticket (**UNVERIFIED here**, see https://code.claude.com/docs/en/sandboxing).
- Permission `deny` rules `Edit(<vault>/**)` / `Read(<vault>/**)` are a complement: deny rules hold even if a hook says allow, and match either symlink requested or resolved path [perms]. They apply to Claude's file tools, not to Bash-spawned processes [perms, "Bash rules ... isn't a security boundary"].

## 7. Takeaways for #34

1. Edit/Write: `tool_input.file_path` is absolute and `~`/relative-expanded, so prefix comparison is reliable after you `realpath` it yourself (symlink resolution is not done for you).
2. Bash: the hook sees raw `command` + `cwd` only; any "touches Vault" test is heuristic. "Allow only `brain-dump ...`" (allowlist the command shape) is more robust than "deny anything mentioning the Vault".
3. Exit 2 (stderr = reason shown to Claude) or JSON `deny`; any other failure exits fail open, so script errors must be handled explicitly.
4. Works in every permission mode including bypass, and inside subagents, when installed via settings or a plugin.
5. For a hard guarantee, pair with sandbox/deny rules; a hook alone is not a security boundary against indirect Bash access.

## Unverified summary

- NotebookEdit and MultiEdit `tool_input` hook schemas.
- Whether `notebook_path` is absolute/expanded before hooks.
- Whether PowerShell tool is enabled on macOS.
- Whether Bash `command` is ever pre-expanded (assumed raw).
- Cross-scope precedence of `disableAllHooks`.
- Sandbox filesystem specifics.
- The claude-code GitHub changelog was not consulted; version-specific behaviour changes (e.g. "Requires v2.1.210") are cited from the docs only.
