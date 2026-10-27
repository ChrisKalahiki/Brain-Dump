import { join } from "node:path";

// The Vault's shape, as paths relative to its root. Every command takes Vault locations from here.

export const INBOX = "Inbox";
export const FILED_FOLDER = join(INBOX, "Filed");
export const ROUTES_NOTE = join(INBOX, "Filing Routes.md");
export const WEEKLY_FOLDER = join("Research", "Weekly Meetings");
export const BRIEFINGS_FOLDER = join("Research", "Briefings");
/** The only notes the Briefing writer may create: `Daily/YYYY-MM-DD Daily Briefing.md` and `Weekly/YYYY-Www Weekly Briefing.md` (ADR 0012). */
export const BRIEFING_NOTE = new RegExp(
  `^${BRIEFINGS_FOLDER}/(?:Daily/\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01]) Daily|Weekly/\\d{4}-W(?:0[1-9]|[1-4]\\d|5[0-3]) Weekly) Briefing\\.md$`,
);
export const WEEKLY_TEMPLATE_NOTE = join("Research", "Other", "Templates", "XX-XX-XX Weekly Update.md");

/** The folder trees, subfolders included, Brain-Dump may write. Defined in code only so nothing inside the Vault can widen it (ADR 0004). */
export const WRITE_ALLOWLIST: readonly string[] = [INBOX, join("Research", "Main Notes"), WEEKLY_FOLDER, "Side Projects", "Resources", BRIEFINGS_FOLDER];

/** The allowlist less Briefings, which Filing, recall, check and the Vault pointer never read (ADR 0012). */
export const FILING_TREES: readonly string[] = WRITE_ALLOWLIST.filter((tree) => tree !== BRIEFINGS_FOLDER);
