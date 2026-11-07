import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { dryRunDumps, isDumpFile, parseDump, prepareDump, writeDumps } from "./dump.ts";
import { BrainDumpError, UsageError } from "./errors.ts";
import { FILED_FOLDER, INBOX } from "./layout.ts";
import { TODOIST } from "./origin.ts";
import { refuseSecret } from "./secrets.ts";
import type { TodoistTask } from "./todoist-api.ts";
import { todoistTaskUrl } from "./todoist-origin.ts";
import type { Vault } from "./vault.ts";

type ImportedTask = { id: string; dump: string };
export type TodoistImportResult = {
  run: string | null;
  imported: ImportedTask[];
  skipped: ImportedTask[];
  preview?: (ImportedTask & { contents: string })[];
};

/** Captures selected assignments as immutable Inbox snapshots; never writes Weekly Notes or Todoist. */
export function importTodoistTasks(vault: Vault, tasks: TodoistTask[], ids: string[], options: { at: Date; dryRun?: boolean }): TodoistImportResult {
  const assigned = new Map(tasks.map((task) => [task.id, task]));
  const selected = [...new Set(ids)].map((id) => {
    const task = assigned.get(id);
    if (task === undefined) throw new UsageError(`Todoist task ${JSON.stringify(id)} is not currently assigned to you`);
    return task;
  });
  const known = importedTasks(vault);
  const skipped = selected.flatMap(({ id }) => {
    const dump = known.get(id);
    return dump === undefined ? [] : [{ id, dump }];
  });
  const pending = selected.filter(({ id }) => !known.has(id));
  if (pending.length === 0) return { run: null, imported: [], skipped };
  const dumps = pending.map((task) => {
    refuseSecret(task.content, "Dump");
    const title = markdownText(task.content);
    return prepareDump({
      origin: { kind: "todoist", tool: TODOIST, task: task.id, remoteProject: task.projectId, project: undefined, at: options.at },
      slug: `task ${Array.from(task.content.replace(/\s+/gu, " ")).slice(0, 40).join("")}`,
      body: `## Todos\n- [ ] ${title} [Todoist](${todoistTaskUrl(task.id)}) #todo\n`,
    });
  });
  if (options.dryRun) {
    const previews = dryRunDumps(vault, dumps);
    return { run: null, imported: [], skipped, preview: previews.map(({ path, contents }, index) => ({ id: pending[index]!.id, dump: relative(vault.root, path), contents })) };
  }
  const result = writeDumps(vault, { command: "todoist-import", label: `Todoist: ${pending.length} selected tasks` }, dumps);
  return { run: result.run, imported: result.paths.map((path, index) => ({ id: pending[index]!.id, dump: relative(vault.root, path) })), skipped };
}

/** Read both locations so Filing, dropping, renaming or a new week cannot duplicate an imported ID. */
function importedTasks(vault: Vault): Map<string, string> {
  const known = new Map<string, string>();
  for (const folder of [INBOX, FILED_FOLDER]) {
    const directory = join(vault.root, folder);
    if (!existsSync(directory)) continue;
    for (const name of readdirSync(directory).filter(isDumpFile).sort()) {
      const path = join(directory, name);
      const contents = readFileSync(path, "utf8");
      if (!/^(?:  - Todoist|todoist-task:.*|Todoist:.*)$/m.test(contents)) continue;
      const parsed = parseDump(path, contents);
      if ("problem" in parsed || parsed.origin.kind !== "todoist") throw new BrainDumpError(`cannot read Todoist identity in ${relative(vault.root, path)}`);
      if (!known.has(parsed.origin.task)) known.set(parsed.origin.task, relative(vault.root, path));
    }
  }
  return known;
}

/** Remote task content is one line of literal Markdown text, not a Dump body. */
function markdownText(text: string): string {
  return text.replace(/[\s\u0000-\u001f\u007f]+/gu, " ").trim().replace(/[\\`*_{}\[\]<>#!|~]/g, "\\$&");
}
