#!/usr/bin/env bash
# Links Brain-Dump into place. Creates symlinks only; never edits any config.
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

cat <<EOF

Manual steps (one-time):
- Make sure ~/.local/bin is on your PATH.
- macOS: give your terminal app access to the Documents folder
  (System Settings > Privacy & Security > Files and Folders).
- The Vault defaults to ~/Documents/The Vault. To use another path, put
  "vault = <path>" in ~/.config/brain-dump/config.
EOF
