import { join } from "node:path";
import type { TodoistTask } from "../src/todoist-api.ts";
import type { RunResult, Sandbox } from "./harness.ts";

export const TODOIST_AT = "2026-11-06T10:30:00Z";

export function assignedTask(id = "task-1", content = "Review report"): TodoistTask {
  return { id, content, projectId: "team-project", due: null, url: `https://app.todoist.com/app/task/${encodeURIComponent(id)}` };
}

/** Isolates the real gateway and Run store exactly as CLI tests do. */
export function runImport(sandbox: Sandbox, tasks: TodoistTask[], ids: string[], dryRun = false): RunResult {
  const result = Bun.spawnSync(["bun", join(import.meta.dir, "fixtures", "todoist-import-driver.ts")], {
    env: { PATH: process.env.PATH, HOME: sandbox.home, TZ: "UTC", BRAIN_DUMP_NOW: TODOIST_AT },
    stdin: Buffer.from(JSON.stringify({ tasks, ids, dryRun })),
  });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}
