import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BrainDumpError, describeFsError } from "./errors.ts";

const DEFAULT_VAULT = join("Documents", "The Vault");

export type Vault = {
  root: string;
  inbox: string;
};

export function locateVault(): Vault {
  const root = resolveVaultPath();
  if (!existsSync(root)) {
    throw new BrainDumpError(`Vault not found at ${root}`);
  }
  if (!existsSync(join(root, ".obsidian"))) {
    throw new BrainDumpError(`${root} is not an Obsidian Vault (no .obsidian/)`);
  }
  const inbox = join(root, "Inbox");
  try {
    mkdirSync(inbox, { recursive: true });
  } catch (error) {
    throw new BrainDumpError(`cannot create ${inbox}: ${describeFsError(error)}`);
  }
  return { root, inbox };
}

function resolveVaultPath(): string {
  const configured = readConfiguredVault();
  return configured ?? join(homedir(), DEFAULT_VAULT);
}

function readConfiguredVault(): string | undefined {
  const configPath = join(homedir(), ".config", "brain-dump", "config");
  if (!existsSync(configPath)) return undefined;
  for (const line of readFileSync(configPath, "utf8").split("\n")) {
    const match = /^\s*vault\s*=\s*(.+?)\s*$/.exec(line);
    if (match?.[1]) return expandHome(match[1]);
  }
  return undefined;
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}
