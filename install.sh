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
settings="$HOME/.claude/settings.json"

# Merges the Vault guard's PreToolUse entry into Claude Code's user settings, keeping every existing entry.
install_guard() {
  GUARD_COMMAND="$guard_command" SETTINGS="$settings" bun -e '
    import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
    import { dirname } from "node:path";
    const { GUARD_COMMAND: command, SETTINGS: path } = process.env;
    const settings = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
    const hooks = (settings.hooks ??= {});
    const entries = (hooks.PreToolUse ??= []);
    if (entries.some((entry) => entry.hooks?.some((hook) => hook.command === command))) {
      console.log(`Vault guard already in ${path}`);
      process.exit(0);
    }
    entries.push({ matcher: "Edit|Write|NotebookEdit|MultiEdit|Read|Grep|Glob|Bash|PowerShell", hooks: [{ type: "command", command, timeout: 5 }] });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.brain-dump-tmp`, `${JSON.stringify(settings, null, 2)}\n`);
    renameSync(`${path}.brain-dump-tmp`, path);
    console.log(`added the Vault guard to ${path}`);
  '
}

if [[ -f "$settings" ]] && grep -qF "\"$guard_command\"" "$settings"; then
  echo "Vault guard already in $settings"
else
  echo
  echo "The Vault guard is a Claude Code hook that stops agents reaching the Vault except through brain-dump."
  echo "It runs before every Edit, Write, Read, Grep, Glob and Bash call, in every project."
  read -r -p "Install it in $settings? [Y/n] " answer || answer=""
  if [[ ! "$answer" =~ ^[Nn] ]]; then
    if install_guard; then
      echo "To remove it, delete the PreToolUse entry running \"$guard_command\" from $settings."
    else
      echo "brain-dump install: could not update $settings; the Vault guard is not installed" >&2
    fi
  fi
fi

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
