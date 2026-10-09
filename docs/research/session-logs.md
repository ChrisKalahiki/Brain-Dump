# Research: where Claude Code and Codex store Session logs

Answers [#41](https://github.com/ChrisKalahiki/Brain-Dump/issues/41) (part of [#29](https://github.com/ChrisKalahiki/Brain-Dump/issues/29)): where do Claude Code and Codex CLI keep local Session transcripts on macOS and Linux, in what format, how stable is that format, how do you find the Sessions for a given day and repo, and is material lost to context compaction still in the log?

- Researched: 2026-10-09
- Local versions checked: Claude Code `2.1.295`, Codex CLI `0.162.0`, macOS (Darwin)
- Sources: official Claude Code docs (`code.claude.com`), the `openai/codex` source at commit [`8ec80de`](https://github.com/openai/codex/tree/8ec80de0ef55d2fb393332d75c32df9751496a58) (2026-10-09), OpenAI Codex docs, and `anthropics/claude-code` GitHub issues. All read on 2026-10-09.
- Local inspection recorded structure only: record types, field names, and path patterns. No transcript content is quoted.
- Anything not confirmed from a primary source is marked **Unverified**.
- Linux was not tested on a Linux machine. Both tools use `$HOME`-relative paths with no OS branching in the sources cited, so the paths below hold on Linux too. **Unverified** on a real Linux install.

## Bottom line

1. **Both tools write append-style JSONL transcripts under a per-user home directory.** Claude Code: `~/.claude/projects/<project>/<session-id>.jsonl`. Codex: `~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<thread-id>.jsonl`.
2. **Neither transcript format is a stable interface.** Anthropic says the Claude Code entry format "is internal to Claude Code and changes between versions". Codex defines its format in Rust source with no stability promise in the docs I found. A sweep must parse defensively and degrade, not assume fields.
3. **Mapping a Session to a repo and a day is easy in Codex and workable in Claude Code.** Codex puts the date in the directory path and `cwd` plus git info in the first record. Claude Code puts the project (the encoded working directory) in the path, and the date and `cwd` in each record.
4. **Retention differs sharply.** Claude Code deletes transcripts older than 30 days by default (`cleanupPeriodDays`). Codex has no age-based deletion that I could find, but an under-development, off-by-default feature compresses rollouts older than 7 days into `.zst` files.
5. **Compaction does not erase the log in Codex, and mostly does not in Claude Code, but Claude Code has open bugs.** Codex rollouts are append-only and keep every pre-compaction item (verified on local files). For Claude Code the docs do not say; the transcript is described as the "full conversation transcript" and issue reports show pre-compaction rows staying in the file, but one open report shows earlier segments being dropped in cloud Cowork sessions.

## 1. Claude Code

### Location and layout

- Transcripts are JSONL at `~/.claude/projects/<project>/<session-id>.jsonl`, where `<project>` is the working directory path with every non-alphanumeric character replaced by `-`. Names over 200 characters are truncated to 200 and get a hash appended. Source: [Sessions: where transcripts are stored](https://code.claude.com/docs/en/sessions#where-transcripts-are-stored).
- `/Users/me/proj` becomes `-Users-me-proj`. Source: [Agent SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions). Because every non-alphanumeric character becomes `-`, the encoding is lossy: `/a/b-c` and `/a-b/c` collide, and the original path cannot be recovered from the directory name alone. This follows from the documented rule; I did not test a collision.
- `CLAUDE_CONFIG_DIR` moves the whole tree; `CLAUDE_CODE_PROJECT_DIR_NAME` (with `CLAUDE_CONFIG_DIR`) names the `<project>` directory yourself. Source: [Sessions](https://code.claude.com/docs/en/sessions#where-transcripts-are-stored), [env vars](https://code.claude.com/docs/en/env-vars).
- Related files under `~/.claude/` ([Explore the .claude directory](https://code.claude.com/docs/en/claude-directory#cleaned-up-automatically)):
  - `projects/<project>/<session>/subagents/` holds subagent transcripts.
  - `projects/<project>/<session>/tool-results/` holds large tool outputs spilled to separate files.
  - `projects/<project>/<session>.orphaned-<timestamp>-<suffix>.jsonl` and `<session>.jsonl.superseded-<timestamp>` are set-aside previous transcripts. They do not show in the session picker, and a sweep globbing `*.jsonl` should decide whether to skip them.
  - `history.jsonl` holds every typed prompt with timestamp and project path.
- Hooks receive a `transcript_path` field pointing at the live transcript. The file is written asynchronously and may lag the in-memory conversation. Source: [Hooks: common input fields](https://code.claude.com/docs/en/hooks#common-input-fields).
- Non-interactive `claude -p` sessions also persist unless `--no-session-persistence` is passed, and `CLAUDE_CODE_SKIP_PROMPT_HISTORY` suppresses transcript writes in all modes. Source: [Sessions](https://code.claude.com/docs/en/sessions#where-transcripts-are-stored).

### Format and stability

- Each line is "a JSON object for a message, tool use, or metadata entry." Anthropic states: "The entry format is internal to Claude Code and changes between versions, so scripts that parse these files directly can break on any release. To build on session data, use `/export` or the script interfaces instead." Source: [Sessions: where transcripts are stored](https://code.claude.com/docs/en/sessions#where-transcripts-are-stored). **The on-disk format is officially undocumented and unstable.**
- The sanctioned script interfaces are `claude -p --output-format json|stream-json`, `claude -p --resume <id>`, the `transcript_path` hook field, and the Agent SDK. Source: [Access conversations from scripts](https://code.claude.com/docs/en/sessions#access-conversations-from-scripts). None of them enumerates past Sessions by day, so a sweep still has to read the files.
- The Agent SDK documents a `compact_boundary` message type (`type: "system"`, `subtype: "compact_boundary"`, `compact_metadata: { trigger: "manual" | "auto", pre_tokens }`). Source: [TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript). This is the SDK's streamed message, not a documented on-disk schema. The on-disk row uses camelCase (`compactMetadata`), per [issue #99068](https://github.com/anthropics/claude-code/issues/99068).
- **Observed record shapes (local, 6 transcripts, structure only).** Top-level `type` values: `user`, `assistant`, `attachment`, `system`, `last-prompt`, `mode`, `permission-mode`, `ai-title`, `file-history-snapshot`, `file-history-delta`, `queue-operation`, `cost-state`, `pr-link`, plus a few tool-specific types. `system` records carry a `subtype` (`turn_duration`, `stop_hook_summary`, `away_summary`, `local_command`, `informational`). `user` and `assistant` records carry `uuid`, `parentUuid`, `sessionId`, `timestamp`, `cwd`, `gitBranch`, `version`, `isSidechain`, `entrypoint`, `userType`, and `message`. None of this is documented by Anthropic, and it changes between versions.

### Finding Sessions for a repo and a day

- **Repo:** compute the encoded form of the repo's absolute path and list `~/.claude/projects/<encoded>/`. Sessions started in a subdirectory of the repo, or in a git worktree, land in different `<project>` directories because the name derives from the working directory. Claude Code's own resume lookup searches the current project and its git worktrees ([Sessions](https://code.claude.com/docs/en/sessions#resume-a-session)), but nothing documents that the files are grouped that way on disk. A sweep that wants all of a repo's Sessions should also match on each record's `cwd` and `gitBranch`. The per-record `cwd` field is observed locally, not documented.
- **Day:** the filename is a session UUID with no date. Use per-record `timestamp` (observed, ISO-8601) or the file's modification time. Whether `timestamp` is UTC or local was not checked, so verify before bucketing by local calendar day.

### Retention and cleanup

- Default: transcripts older than `cleanupPeriodDays` are deleted, default 30 days, minimum 1; `0` fails validation. Source: [.claude directory: cleaned up automatically](https://code.claude.com/docs/en/claude-directory#cleaned-up-automatically).
- The sweep runs per Claude Code session. It is skipped in `claude -p --bare` and paused when the retention period cannot be determined. Source: same page.
- Transcripts for sessions started or last continued in Claude Desktop or Cowork are kept at any age unless `desktopSessionCleanupPeriodDays` is set (Claude Code v2.1.248+). Source: same page.
- `claude purge <path>` deletes a project's transcripts and state. Source: same page.
- Transcripts are not encrypted, and any secret a tool printed or read is in the file. Source: same page ("Transcripts and history are not encrypted at rest"). Relevant to a sweep that drafts Dumps from them.
- Implication: a daily sweep sees the last 30 days at most, per default.

### Compaction

- The docs describe compaction as replacing the in-context history with a summary ([Context window](https://code.claude.com/docs/en/context-window), [Sessions](https://code.claude.com/docs/en/sessions#resume-a-session)). **They do not state whether pre-compaction messages stay in the `.jsonl`.** The directory docs call the file the "Full conversation transcript: every message, tool call, and tool result".
- Evidence from `anthropics/claude-code` issues (bug reports, not Anthropic documentation):
  - [#92089](https://github.com/anthropics/claude-code/issues/92089): a `/compact` appends a `compact_boundary` and summary row to the same file; rows before it stay. The reporter also shows a second `/compact` in one process re-appending copies of earlier rows with their original `uuid`, `parentUuid` and `timestamp`, so a reader must de-duplicate by `uuid`. Reported on 2.1.237 to 2.1.286.
  - [#96485](https://github.com/anthropics/claude-code/issues/96485) and [#48937](https://github.com/anthropics/claude-code/issues/48937): the boundary row has `parentUuid: null`, which cuts the parent chain, while the earlier rows remain in the file. Snippet-level reading only for these two.
  - [#99068](https://github.com/anthropics/claude-code/issues/99068) (open, Claude Code 2.1.288 and 2.1.290): in cloud Cowork sessions the file "only contains the latest segment" and its first line is a `compact_boundary`. A commenter reports the same on a local CLI session (unconfirmed by the maintainers). This is the counter-example: pre-compaction material can be absent from the local file.
- **Local check:** none of the 6 local Claude Code transcripts contained a compaction record, so I could not confirm the behavior on this machine.
- **Verdict (Unverified, leaning yes):** in ordinary local CLI sessions pre-compaction rows are likely still in the file, but this is not documented and #99068 shows it can fail. Design the sweep so a missing earlier segment is a normal, detected case (a `compact_boundary` as the first row means earlier material is gone).
- Mitigation that is documented: a `SessionEnd` hook can archive the transcript when a session ends ([Sessions](https://code.claude.com/docs/en/sessions#access-conversations-from-scripts)), and a `PreCompact` hook fires before compaction ([Hooks](https://code.claude.com/docs/en/hooks)). Either could copy material out before it is lost.

## 2. Codex CLI

### Location and layout

- State lives under `CODEX_HOME`, default `~/.codex`. Source: [Codex advanced config: config and state locations](https://developers.openai.com/codex/config-advanced).
- Transcripts ("rollouts") are JSONL at `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<timestamp>-<thread-id>.jsonl`. Source: [`rollout/src/recorder.rs`, path builder (L1744-L1761)](https://github.com/openai/codex/blob/8ec80de0ef55d2fb393332d75c32df9751496a58/codex-rs/rollout/src/recorder.rs#L1744-L1761) and [`rollout_file_name.rs`](https://github.com/openai/codex/blob/8ec80de0ef55d2fb393332d75c32df9751496a58/codex-rs/rollout/src/rollout_file_name.rs). The `YYYY/MM/DD` comes from `OffsetDateTime::now_local()`, so it is the **local** date at session start.
- A `thread/revert` creates a new immutable file named `rollout-<timestamp>-<thread-id>_<rollout-id>.jsonl` for the same thread. Source: [`recorder.rs` L99-L103](https://github.com/openai/codex/blob/8ec80de0ef55d2fb393332d75c32df9751496a58/codex-rs/rollout/src/recorder.rs#L99-L103). A sweep should group files by thread id.
- Archived sessions go to `$CODEX_HOME/archived_sessions` (`ARCHIVED_SESSIONS_SUBDIR`). Source: [`rollout/src/lib.rs` L86-L87](https://github.com/openai/codex/blob/8ec80de0ef55d2fb393332d75c32df9751496a58/codex-rs/rollout/src/lib.rs#L86-L87). The directory does not exist on this machine.
- Other files, observed locally (names and fields only): `history.jsonl` (fields `session_id`, `text`, `ts`: typed prompts only), `session_index.jsonl` (fields `id`, `thread_name`, `updated_at`; matches `SessionIndexEntry` in [`session_index.rs`](https://github.com/openai/codex/blob/8ec80de0ef55d2fb393332d75c32df9751496a58/codex-rs/rollout/src/session_index.rs)), and several SQLite state databases.
- **Docs wording is misleading.** The Codex docs say "By default, Codex saves local session transcripts under `CODEX_HOME` (for example, `~/.codex/history.jsonl`)" ([config-advanced: history persistence](https://developers.openai.com/codex/config-advanced)). In the source and on disk, `history.jsonl` holds prompts only, and the full transcript is the rollout under `sessions/`.

### Format and stability

- Each line is `{ "timestamp", "type", "payload" }`. `type` values observed locally (186 files, structure only): `session_meta`, `response_item`, `event_msg`, `turn_context`, `compacted`, `token_usage_record`, `world_state`, `inter_agent_communication_metadata`. `response_item` payload types include `message`, `reasoning`, `function_call`, `function_call_output`, `custom_tool_call`, `custom_tool_call_output`, `web_search_call`, `agent_message`. `event_msg` payload types include `user_message`, `agent_message`, `token_count`, `task_started`, `task_complete`, `context_compacted`, `exec_command_end`, `patch_apply_end`. A `user_message` event is the simplest way to pull what the user typed.
- The Rust enum `RolloutItem` is the source of the record types: [`history/src/lib.rs` L215-L231](https://github.com/openai/codex/blob/8ec80de0ef55d2fb393332d75c32df9751496a58/codex-rs/history/src/lib.rs#L215-L231). The recorder's doc comment shows reading a rollout with `jq` and `fx` ([`recorder.rs` L82-L83](https://github.com/openai/codex/blob/8ec80de0ef55d2fb393332d75c32df9751496a58/codex-rs/rollout/src/recorder.rs#L82-L83)), so inspecting the files directly is an intended use.
- **No documented stability guarantee.** I found no OpenAI doc that specifies the rollout schema. The format is open source and defined by serde types that carry `#[serde(default)]` compatibility handling and "older histories" comments, which suggests additive evolution, but that is my reading and **Unverified** as a policy. Compare to Claude Code, which explicitly warns against parsing.
- The supported programmatic route is the Codex app server and its protocol (`app-server-protocol` crate). I did not evaluate it.

### Finding Sessions for a repo and a day

- **Day:** list `sessions/YYYY/MM/DD/`. The path uses the local date at session start. A Session that runs past midnight stays in its start-day directory, so a sweep needs to read the last record timestamp or file mtime for "active today" logic.
- **Repo:** the first line is `session_meta` with a payload that includes `cwd`, `id`, `cli_version`, `originator`, `model_provider`, `timestamp`, `source`, and a git block (all observed locally; the full struct is [`SessionMeta`](https://github.com/openai/codex/blob/8ec80de0ef55d2fb393332d75c32df9751496a58/codex-rs/protocol/src/protocol.rs#L3243-L3300), which also has `GitInfo` with commit hash, branch and repository URL at [L3534](https://github.com/openai/codex/blob/8ec80de0ef55d2fb393332d75c32df9751496a58/codex-rs/protocol/src/protocol.rs#L3534)). Match `cwd` against the repo root, or use the git repository URL to cover worktrees and clones. Each `turn_context` record also carries a `cwd`.
- Sub-agent threads appear as their own rollouts with `parent_thread_id` / `source` set in `session_meta` (struct fields at the link above), so a sweep may want to skip or fold those.

### Retention and cleanup

- **No age-based deletion found.** A search of `rollout/src` and `config/src/types.rs` for retention, TTL or expiry logic found nothing for rollouts. The only size cap is `history.max_bytes`, and it applies to `history.jsonl` only ([config types L220-L233](https://github.com/openai/codex/blob/8ec80de0ef55d2fb393332d75c32df9751496a58/codex-rs/config/src/types.rs#L220-L233), [docs](https://developers.openai.com/codex/config-advanced)). Local files go back to 2026-03 here. This is a negative result from grep, so **Unverified** against the full codebase.
- `[history] persistence = "none"` disables `history.jsonl` writes. Whether it also disables rollouts was not determined.
- **Compression risk:** the `local_thread_store_compression` feature ("Compress cold local thread-store rollout files") compresses rollouts older than 7 days to `.zst` (`MIN_ROLLOUT_AGE` 7 days). It is `Stage::UnderDevelopment` and `default_enabled: false`, and its doc comment warns it "requires every reader of the Codex home to support compressed shared histories". Sources: [`features/src/lib.rs` L197-L199, L1266-L1270](https://github.com/openai/codex/blob/8ec80de0ef55d2fb393332d75c32df9751496a58/codex-rs/features/src/lib.rs#L1266-L1270), [`rollout/src/compression.rs` L364](https://github.com/openai/codex/blob/8ec80de0ef55d2fb393332d75c32df9751496a58/codex-rs/rollout/src/compression.rs#L364). All 186 local files are plain `.jsonl`. A sweep should accept `.jsonl.zst` or fail loudly if it appears.

### Compaction

- A compaction appends a `compacted` record (payload fields include `message` and `replacement_history`) and a `context_compacted` event. The type is [`CompactedItem`](https://github.com/openai/codex/blob/8ec80de0ef55d2fb393332d75c32df9751496a58/codex-rs/history/src/lib.rs#L290). The rollout is append-only, so the pre-compaction items stay.
- **Verified locally:** in a rollout that contains two compactions, 837 records precede the first `compacted` record and 1726 precede the second, i.e. the earlier records remain in the file after compaction. The `replacement_history` on those records has only 32 and 56 entries, so the compacted record is the model-facing replacement, not the full history.
- **Verdict: yes.** Material lost to compaction is still in the Codex log, in the records before the `compacted` line.
- `replacement_history` can contain content that was kept or rewritten for the model, so a sweep reading the whole file should not double-count it as new user activity. Use `event_msg` / `user_message` for what the user typed.

## 3. Side-by-side

| | Claude Code | Codex CLI |
| - | - | - |
| Root | `~/.claude` (`CLAUDE_CONFIG_DIR`) | `~/.codex` (`CODEX_HOME`) |
| Transcript | `projects/<encoded-cwd>/<session-id>.jsonl` | `sessions/YYYY/MM/DD/rollout-<ts>-<thread-id>.jsonl` |
| Date in path | No | Yes, local start date |
| Repo in path | Yes, lossy encoding of cwd | No; `cwd` and git info in first record |
| Format documented | No; "internal... changes between versions" | No schema doc; open source Rust types |
| Retention | 30 days default (`cleanupPeriodDays`) | No age deletion found; optional `.zst` compression after 7 days (off) |
| Pre-compaction content in file | Likely, not documented, open bugs | Yes, verified locally |
| Prompt-only index | `~/.claude/history.jsonl` | `~/.codex/history.jsonl`, `session_index.jsonl` |
| Hooks to copy out | `SessionEnd`, `PreCompact` with `transcript_path` | Not evaluated |

## Open questions

- Claude Code: does a local CLI transcript keep rows before a `compact_boundary` in current versions? Needs a test with a real compaction (none on this machine) or a statement from Anthropic.
- Claude Code: is the per-record `timestamp` UTC? Matters for bucketing by local calendar day.
- Codex: does `[history] persistence = "none"` stop rollout writes, and is there any rollout retention outside `rollout/src`?
- Codex: do its hooks offer an equivalent of Claude Code's `SessionEnd` and `PreCompact` for copy-out? Not evaluated.
- Linux paths are inferred, not tested on Linux.
