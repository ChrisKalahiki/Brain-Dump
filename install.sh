#!/usr/bin/env bash
# Links Brain-Dump into place, then asks before each config change.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

link() {
  local target="$1" link_path="$2"
  mkdir -p "$(dirname "$link_path")"
  if [[ -L "$link_path" ]]; then
    local current
    current="$(readlink "$link_path")"
    if [[ "$current" != "$target" ]]; then
      echo "brain-dump install: $link_path already points to $current; leaving it alone" >&2
      return 1
    fi
  elif [[ -e "$link_path" ]]; then
    echo "brain-dump install: $link_path exists and is not a symlink; leaving it alone" >&2
    return 1
  else
    ln -s "$target" "$link_path"
  fi
  echo "linked $link_path -> $target"
}

if ! command -v bun >/dev/null 2>&1; then
  echo "brain-dump install: Bun is required (https://bun.sh)" >&2
  exit 1
fi

link "$repo/src/cli.ts" "$HOME/.local/bin/brain-dump"
link "$repo/skills/dump" "$HOME/.claude/skills/dump"
link "$repo/skills/dump" "$HOME/.agents/skills/dump"
link "$repo/skills/file" "$HOME/.claude/skills/file"
link "$repo/skills/consolidate" "$HOME/.claude/skills/consolidate"
link "$repo/skills/recall" "$HOME/.claude/skills/recall"
link "$repo/skills/recall" "$HOME/.agents/skills/recall"

guard_command="$HOME/.local/bin/brain-dump guard"
pointer_command="$HOME/.local/bin/brain-dump pointer"

# Merges an entry running a command on a hook event into a Claude Code settings file or Codex hooks file; an empty matcher matches everything.
install_hook() {
  local path="$1" event="$2" command="$3" matcher="$4"
  HOOK_COMMAND="$command" HOOKS_FILE="$path" HOOK_EVENT="$event" MATCHER="$matcher" bun -e '
    import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
    import { dirname } from "node:path";
    const { HOOK_COMMAND: command, HOOKS_FILE: path, HOOK_EVENT: event, MATCHER: matcher } = process.env;
    const settings = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
    const hooks = [{ type: "command", command, timeout: 5 }];
    ((settings.hooks ??= {})[event] ??= []).push(matcher ? { matcher, hooks } : { hooks });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.brain-dump-tmp`, `${JSON.stringify(settings, null, 2)}\n`);
    renameSync(`${path}.brain-dump-tmp`, path);
  '
}

# Asks before adding a hook to one tool's file; skips a file that already runs its command.
offer_hook() {
  local path="$1" event="$2" command="$3" matcher="$4" name="$5" pitch="$6" after="${7:-}" answer
  local removal="To remove it, delete the $event entry running \"$command\" from $path."
  if [[ -f "$path" ]] && grep -qF "\"$command\"" "$path"; then
    echo "$name already in $path. $removal"
    [[ -z "$after" ]] || echo "$after"
    return
  fi
  echo
  echo "$pitch"
  echo "$removal"
  read -r -p "Install it in $path? [Y/n] " answer || answer=""
  if [[ "$answer" =~ ^[Nn] ]]; then
    return
  fi
  if install_hook "$path" "$event" "$command" "$matcher"; then
    echo "added the $name to $path"
    [[ -z "$after" ]] || echo "$after"
  else
    echo "brain-dump install: could not update $path; the $name is not installed" >&2
  fi
}

offer_guard() {
  local path="$1" matcher="$2" tool="$3" covers="$4" after="${5:-}"
  offer_hook "$path" PreToolUse "$guard_command" "$matcher" "Vault guard" \
    "The Vault guard is a $tool hook that stops agents reaching the Vault except through brain-dump.
It runs before every $covers call, in every project." "$after"
}

offer_pointer() {
  local path="$1" tool="$2" after="${3:-}"
  offer_hook "$path" SessionStart "$pointer_command" "" "Vault pointer" \
    "The Vault pointer is a $tool hook that names this repo's Vault notes and any Vault findings when a Session starts.
It runs at the start of every Session, in every project, and prints nothing when there is nothing to say." "$after"
}

codex_trust="Codex skips new hooks until you trust them: run /hooks in Codex once and trust the brain-dump entries."

offer_guard "$HOME/.claude/settings.json" "Edit|Write|NotebookEdit|MultiEdit|Read|Grep|Glob|Bash|PowerShell" "Claude Code" \
  "file-tool (Edit, Write, NotebookEdit, MultiEdit, Read, Grep, Glob) and shell (Bash, PowerShell)"
offer_guard "$HOME/.codex/hooks.json" "Bash|apply_patch" "Codex" "shell (Bash) and apply_patch" "$codex_trust"
offer_pointer "$HOME/.claude/settings.json" "Claude Code"
offer_pointer "$HOME/.codex/hooks.json" "Codex" "$codex_trust"

cat <<EOF

Manual steps (one-time):
- Make sure ~/.local/bin is on your PATH.
- macOS: give your terminal app access to the Documents folder
  (System Settings > Privacy & Security > Files and Folders).
- Chat capture: paste $repo/prompts/chat-dump.md into a Claude Project's
  instructions (or into ChatGPT / Gemini when needed), then hand its output
  to "dump --paste".
- "dump <chat URL>" (Claude Code only) needs the Claude in Chrome extension.
- The Vault defaults to ~/Documents/The Vault. To use another path, put
  "vault = <path>" in ~/.config/brain-dump/config.
EOF
