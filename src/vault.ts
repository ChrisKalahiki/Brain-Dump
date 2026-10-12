import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BrainDumpError, describeFsError } from "./errors.ts";
import { INBOX } from "./layout.ts";

const DEFAULT_VAULT = join("Documents", "The Vault");

export type Vault = {
  root: string;
  inbox: string;
};

export function locateVault(): Vault {
  const vault = findVault();
  try {
    mkdirSync(vault.inbox, { recursive: true });
  } catch (error) {
    throw new BrainDumpError(`cannot create ${vault.inbox}: ${describeFsError(error)}`);
  }
  return vault;
}

/** The Vault, left untouched: its Inbox may not exist yet. */
export function findVault(): Vault {
  const root = resolveVaultPath();
  if (!existsSync(root)) {
    throw new BrainDumpError(`Vault not found at ${root}`);
  }
  if (!existsSync(join(root, ".obsidian"))) {
    throw new BrainDumpError(`${root} is not an Obsidian Vault (no .obsidian/)`);
  }
  return { root, inbox: join(root, INBOX) };
}

/** Where the Vault should be, from config or the default; it may not exist. */
export function resolveVaultPath(): string {
  const configured = readConfiguredVault();
  return configured ?? join(homedir(), DEFAULT_VAULT);
}

function readConfiguredVault(): string | undefined {
  const configured = readSetting("vault");
  return configured === undefined ? undefined : expandHome(configured);
}

/** A `name = value` line's value from `~/.config/brain-dump/config`, the first one when it is repeated. */
export function readSetting(name: string): string | undefined {
  const configPath = join(homedir(), ".config", "brain-dump", "config");
  if (!existsSync(configPath)) return undefined;
  for (const line of readFileSync(configPath, "utf8").split("\n")) {
    const match = /^\s*([\w-]+)\s*=\s*(.+?)\s*$/.exec(line);
    if (match?.[1] === name && match[2]) return match[2];
  }
  return undefined;
}

export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}
