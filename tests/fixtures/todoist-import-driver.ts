import type { TodoistTask } from "../../src/todoist-api.ts";
import { importTodoistTasks } from "../../src/todoist.ts";
import { findVault } from "../../src/vault.ts";

const input: { tasks: TodoistTask[]; ids: string[]; dryRun: boolean } = JSON.parse(await Bun.stdin.text());
try {
  const result = importTodoistTasks(findVault(), input.tasks, input.ids, { at: new Date("2026-11-06T10:30:00Z"), dryRun: input.dryRun });
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
