import { join } from "node:path";

// The Vault's shape, as paths relative to its root. Every command takes Vault locations from here.

export const INBOX = "Inbox";
export const FILED_FOLDER = join(INBOX, "Filed");
export const ROUTES_NOTE = join(INBOX, "Filing Routes.md");
export const WEEKLY_FOLDER = join("Research", "Weekly Meetings");
export const WEEKLY_TEMPLATE_NOTE = join("Research", "Other", "Templates", "XX-XX-XX Weekly Update.md");

/** The folder trees, subfolders included, Brain-Dump may write. Defined in code only so nothing inside the Vault can widen it (ADR 0004). */
export const WRITE_ALLOWLIST: readonly string[] = [INBOX, join("Research", "Main Notes"), WEEKLY_FOLDER, "Side Projects", "Resources"];
