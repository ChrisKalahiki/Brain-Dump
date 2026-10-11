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

guard_command="$HOME/.local/bin/brain-dump guard"

# Merges a PreToolUse entry running the guard into a Claude Code settings file or Codex hooks file.
install_guard() {
  local path="$1" matcher="$2"
  GUARD_COMMAND="$guard_command" HOOKS_FILE="$path" MATCHER="$matcher" bun -e '
    import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
    import { dirname } from "node:path";
    const { GUARD_COMMAND: command, HOOKS_FILE: path, MATCHER: matcher } = process.env;
    const settings = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
    ((settings.hooks ??= {}).PreToolUse ??= []).push({ matcher, hooks: [{ type: "command", command, timeout: 5 }] });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.brain-dump-tmp`, `${JSON.stringify(settings, null, 2)}\n`);
    renameSync(`${path}.brain-dump-tmp`, path);
    console.log(`added the Vault guard to ${path}`);
  '
}

# Asks before installing the guard in one tool; skips a file that already runs it.
offer_guard() {
  local path="$1" matcher="$2" tool="$3" covers="$4" after="${5:-}" answer
  local removal="To remove it, delete the PreToolUse entry running \"$guard_command\" from $path."
  if [[ -f "$path" ]] && grep -qF "\"$guard_command\"" "$path"; then
    echo "Vault guard already in $path. $removal"
    [[ -z "$after" ]] || echo "$after"
    return
  fi
  echo
  echo "The Vault guard is a $tool hook that stops agents reaching the Vault except through brain-dump."
  echo "It runs before every $covers call, in every project."
  echo "$removal"
  read -r -p "Install it in $path? [Y/n] " answer || answer=""
  if [[ "$answer" =~ ^[Nn] ]]; then
    return
  fi
  if install_guard "$path" "$matcher"; then
    [[ -z "$after" ]] || echo "$after"
  else
    echo "brain-dump install: could not update $path; the Vault guard is not installed" >&2
  fi
}

offer_guard "$HOME/.claude/settings.json" "Edit|Write|NotebookEdit|MultiEdit|Read|Grep|Glob|Bash|PowerShell" "Claude Code" \
  "file-tool (Edit, Write, NotebookEdit, MultiEdit, Read, Grep, Glob) and shell (Bash, PowerShell)"
offer_guard "$HOME/.codex/hooks.json" "Bash|apply_patch" "Codex" "shell (Bash) and apply_patch" \
  "Codex skips new hooks until you trust them: run /hooks in Codex once and trust the brain-dump guard entry."

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
