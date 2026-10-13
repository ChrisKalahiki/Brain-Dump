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

brain_dump="$HOME/.local/bin/brain-dump"
link "$repo/src/cli.ts" "$brain_dump"
link "$repo/skills/dump" "$HOME/.claude/skills/dump"
link "$repo/skills/dump" "$HOME/.agents/skills/dump"
link "$repo/skills/file" "$HOME/.claude/skills/file"
link "$repo/skills/consolidate" "$HOME/.claude/skills/consolidate"
link "$repo/skills/recall" "$HOME/.claude/skills/recall"
link "$repo/skills/recall" "$HOME/.agents/skills/recall"

guard_command="$brain_dump guard"
claude_guard_matcher="$("$brain_dump" guard --matchers claude)"
codex_guard_matcher="$("$brain_dump" guard --matchers codex)"
pointer_command="$brain_dump pointer"

# Asks a yes-or-no question that defaults to yes; fails on a no.
confirm() {
  local answer
  read -r -p "$1 [Y/n] " answer || answer=""
  [[ ! "$answer" =~ ^[Nn] ]]
}

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
  local path="$1" event="$2" command="$3" matcher="$4" name="$5" pitch="$6" after="${7:-}"
  local removal="To remove it, delete the $event entry running \"$command\" from $path."
  if [[ -f "$path" ]] && grep -qF "\"$command\"" "$path"; then
    echo "$name already in $path. $removal"
    [[ -z "$after" ]] || echo "$after"
    return
  fi
  echo
  echo "$pitch"
  echo "$removal"
  confirm "Install it in $path?" || return 0
  if install_hook "$path" "$event" "$command" "$matcher"; then
    echo "added the $name to $path"
    [[ -z "$after" ]] || echo "$after"
  else
    echo "brain-dump install: could not update $path; the $name is not installed" >&2
  fi
}

offer_guard() {
  local path="$1" matcher="$2" tool="$3" after="${4:-}"
  offer_hook "$path" PreToolUse "$guard_command" "$matcher" "Vault guard" \
    "The Vault guard is a $tool hook that stops agents reaching the Vault except through brain-dump.
It runs before every call to the file and shell tools, in every project." "$after"
}

offer_pointer() {
  local path="$1" tool="$2" after="${3:-}"
  offer_hook "$path" SessionStart "$pointer_command" "" "Vault pointer" \
    "The Vault pointer is a $tool hook that names this repo's Vault notes and any Vault findings when a Session starts.
It runs at the start of every Session, in every project, and prints nothing when there is nothing to say." "$after"
}

sweep_pitch="The daily Sweep drafts a Dump into the Vault's Inbox from each recent Claude Code or Codex Session you never dumped."

xml_escape() {
  local value="${1//&/&amp;}"
  value="${value//</&lt;}"
  echo "${value//>/&gt;}"
}

# The launchd agent has no login shell, so it gets this shell's PATH to find bun and claude.
offer_launchd_timer() {
  local label="com.brain-dump.sweep" domain="gui/$(id -u)"
  local plist="$HOME/Library/LaunchAgents/$label.plist" state="$HOME/.local/state/brain-dump"
  local removal="To turn it off: launchctl bootout $domain/$label && rm \"$plist\""
  if [[ -f "$plist" ]]; then
    echo "Daily Sweep already installed as $plist. $removal"
    return
  fi
  echo
  echo "$sweep_pitch"
  echo "It runs at 04:00 on this machine, or when it wakes if it was asleep then; a day it was off is caught up by the next Sweep."
  echo "$removal"
  confirm "Install it as a launchd agent?" || return 0
  mkdir -p "$(dirname "$plist")" "$state"
  cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml_escape "$brain_dump")</string>
    <string>sweep</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(xml_escape "$PATH")</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>4</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>/dev/null</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "$state/sweep.log")</string>
</dict>
</plist>
EOF
  if launchctl bootstrap "$domain" "$plist"; then
    echo "installed the daily Sweep as $plist; its errors go to $state/sweep.log"
    echo "macOS may ask once to let bun reach the Documents folder when it first runs."
  else
    rm -f "$plist"
    echo "brain-dump install: launchctl could not load $plist; the daily Sweep is not installed" >&2
  fi
}

# The systemd user manager has no login shell either, so the service gets this shell's PATH; % is escaped as systemd requires.
offer_systemd_timer() {
  local units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user" name="brain-dump-sweep"
  local removal="To turn it off: systemctl --user disable --now $name.timer && rm \"$units/$name.timer\" \"$units/$name.service\""
  if [[ -f "$units/$name.timer" ]]; then
    echo "Daily Sweep already installed as $units/$name.timer. $removal"
    return
  fi
  echo
  echo "$sweep_pitch"
  echo "It runs at 04:00 on this machine, or at the next boot if it was off or asleep then."
  echo "$removal"
  confirm "Install it as a systemd user timer?" || return 0
  mkdir -p "$units"
  cat >"$units/$name.service" <<EOF
[Unit]
Description=Brain-Dump Sweep

[Service]
Type=oneshot
Environment="PATH=${PATH//%/%%}"
ExecStart=${brain_dump//%/%%} sweep
StandardOutput=null
EOF
  cat >"$units/$name.timer" <<EOF
[Unit]
Description=Daily Brain-Dump Sweep

[Timer]
OnCalendar=*-*-* 04:00:00
Persistent=true

[Install]
WantedBy=timers.target
EOF
  if systemctl --user daemon-reload && systemctl --user enable --now "$name.timer"; then
    echo "installed the daily Sweep as $units/$name.timer; its errors go to journalctl --user -u $name"
    echo "It runs only while you are logged in, unless you run: loginctl enable-linger"
  else
    rm -f "$units/$name.timer" "$units/$name.service"
    echo "brain-dump install: systemctl could not enable $name.timer; the daily Sweep is not installed" >&2
  fi
}

offer_timer() {
  case "$(uname -s)" in
    Darwin) offer_launchd_timer ;;
    Linux) offer_systemd_timer ;;
    *) echo "No daily Sweep timer for $(uname -s); run brain-dump sweep yourself." ;;
  esac
}

codex_trust="Codex skips new hooks until you trust them: run /hooks in Codex once and trust the brain-dump entries."

offer_guard "$HOME/.claude/settings.json" "$claude_guard_matcher" "Claude Code"
offer_guard "$HOME/.codex/hooks.json" "$codex_guard_matcher" "Codex" "$codex_trust"
offer_pointer "$HOME/.claude/settings.json" "Claude Code"
offer_pointer "$HOME/.codex/hooks.json" "Codex" "$codex_trust"
offer_timer

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
