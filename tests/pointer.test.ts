import { describe, expect, test } from "bun:test";
import { dumpFile, makeRepo, makeSandbox, ROUTES_NOTE, run, writeConfig, writeVaultFile, type Sandbox } from "./harness.ts";

const NOW = "2026-10-12T09:00";
const ORIGIN = "Session: Claude Code · `~/Projects/chronos` @ `main` · 2026-10-01 09:00 · [[chronos]]";
const OTHER_ORIGIN = "Session: Codex · `~/Projects/Brain-Dump` @ `main` · 2026-10-02 10:00 · [[Brain-Dump]]";
const FILED_DUMP = "Inbox/Filed/2026-10-01 0900 chronos - queues.md";
const OTHER_DUMP = "Inbox/Filed/2026-10-02 1000 Brain-Dump - guard.md";
const FROM_FILED = "\t- From [[2026-10-01 0900 chronos - queues|dump 10-01-26]]";
const FROM_OTHER = "\t- From [[2026-10-02 1000 Brain-Dump - guard|dump 10-02-26]]";
const DONE_BODY = "## Learnings\n- [x] Filed.\n";
const OPEN_BODY = "## Learnings\n- [ ] Not filed yet.\n";

function filedItems(count: number, label = "A chronos Learning", from = FROM_FILED): string {
  return Array.from({ length: count }, (_, n) => `- ${label} ${n}.\n${from}\n`).join("");
}

/** chronos Items in four notes, another project's Items in a fifth, and nothing for `check` to report. */
function seedVault(sandbox: Sandbox): void {
  writeVaultFile(sandbox, FILED_DUMP, dumpFile(ORIGIN, DONE_BODY));
  writeVaultFile(sandbox, OTHER_DUMP, dumpFile(OTHER_ORIGIN, DONE_BODY, "Codex"));
  writeVaultFile(sandbox, "Side Projects/Scheduling.md", `# Scheduling\n${filedItems(5)}`);
  writeVaultFile(sandbox, "Research/Main Notes/Job Queues.md", `# Job Queues\n${filedItems(2)}${filedItems(4, "A Brain-Dump Learning", FROM_OTHER)}`);
  writeVaultFile(sandbox, "Resources/Retries.md", `# Retries\n${filedItems(3)}`);
  writeVaultFile(sandbox, "Resources/Backoff.md", `# Backoff\n${filedItems(1)}`);
  writeVaultFile(sandbox, "Side Projects/Brain-Dump.md", `# Brain-Dump\n${filedItems(9, "A Brain-Dump Learning", FROM_OTHER)}`);
}

function pointer(sandbox: Sandbox, cwd: string, env: Record<string, string> = {}) {
  const result = run(sandbox, ["pointer"], { cwd, now: NOW, env });
  return [result.exitCode, result.stdout, result.stderr];
}

describe("brain-dump pointer", () => {
  test("names the Route target, then the notes holding the most of this project's Items, and its unfiled Dumps", () => {
    // #given
    const sandbox = makeSandbox();
    seedVault(sandbox);
    writeVaultFile(sandbox, "Side Projects/Chronos Main Note.md", "# Chronos\n");
    writeVaultFile(sandbox, ROUTES_NOTE, "- Chronos → [[Chronos Main Note]]\n");
    writeVaultFile(sandbox, "Inbox/2026-10-05 1200 chronos - locks.md", dumpFile(ORIGIN, OPEN_BODY));
    writeVaultFile(sandbox, "Inbox/2026-10-06 1200 chronos - leases.md", dumpFile(ORIGIN, OPEN_BODY));
    writeVaultFile(sandbox, "Inbox/2026-10-06 1300 Brain-Dump - undo.md", dumpFile(OTHER_ORIGIN, OPEN_BODY, "Codex"));
    const repo = makeRepo(sandbox, "chronos", "main");

    // #when
    const result = pointer(sandbox, repo);

    // #then
    expect(result).toEqual([
      0,
      "brain-dump: Vault notes for chronos: [[Chronos Main Note]] (Route), [[Scheduling]] (5 Items), [[Retries]] (3 Items) · 2 unfiled Dumps · use the recall skill for more\n",
      "",
    ]);
  });

  test("lists a Route target that also holds Items once, as the Route", () => {
    // #given
    const sandbox = makeSandbox();
    seedVault(sandbox);
    writeVaultFile(sandbox, ROUTES_NOTE, "- chronos → [[Retries]]\n");
    const repo = makeRepo(sandbox, "chronos", "main");

    // #when
    const result = pointer(sandbox, repo);

    // #then
    expect(result).toEqual([
      0,
      "brain-dump: Vault notes for chronos: [[Retries]] (Route), [[Scheduling]] (5 Items), [[Job Queues]] (2 Items) · use the recall skill for more\n",
      "",
    ]);
  });

  test("matches no note by its title alone, and names unfiled Dumps when no note holds the project's Items", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, "Side Projects/chronos.md", "# chronos\n- A hand-written note.\n");
    writeVaultFile(sandbox, "Inbox/2026-10-05 1200 chronos - locks.md", dumpFile(ORIGIN, OPEN_BODY));
    const repo = makeRepo(sandbox, "chronos", "main");

    // #when
    const result = pointer(sandbox, repo);

    // #then
    expect(result).toEqual([0, "brain-dump: 1 unfiled Dump for chronos · use the recall skill for more\n", ""]);
  });

  test("adds the check count when the Vault has findings", () => {
    // #given
    const sandbox = makeSandbox();
    seedVault(sandbox);
    writeVaultFile(sandbox, ROUTES_NOTE, "- chronos → [[Gone]]\n- Brain-Dump → [[Also Gone]]\n");
    const repo = makeRepo(sandbox, "chronos", "main");

    // #when
    const result = pointer(sandbox, repo);

    // #then
    expect(result).toEqual([
      0,
      "brain-dump: Vault notes for chronos: [[Scheduling]] (5 Items), [[Retries]] (3 Items), [[Job Queues]] (2 Items) · use the recall skill for more\n" +
        "brain-dump: 2 Vault findings (run brain-dump check)\n",
      "",
    ]);
  });

  test("prints only the check count in a repo the Vault knows nothing about", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, ROUTES_NOTE, "- chronos → [[Gone]]\n");
    const repo = makeRepo(sandbox, "unrelated", "main");

    // #when
    const result = pointer(sandbox, repo);

    // #then
    expect(result).toEqual([0, "brain-dump: 1 Vault finding (run brain-dump check)\n", ""]);
  });

  test("prints nothing when there is nothing to say", () => {
    // #given
    const sandbox = makeSandbox();
    seedVault(sandbox);
    const repo = makeRepo(sandbox, "unrelated", "main");

    // #when
    const result = pointer(sandbox, repo);

    // #then
    expect(result).toEqual([0, "", ""]);
  });

  test("prints nothing when there is no Vault", () => {
    // #given
    const sandbox = makeSandbox();
    writeConfig(sandbox, `vault = ${sandbox.home}/Nowhere\n`);
    const repo = makeRepo(sandbox, "chronos", "main");

    // #when
    const result = pointer(sandbox, repo);

    // #then
    expect(result).toEqual([0, "", ""]);
  });

  test("skips whatever misses the deadline, silently", () => {
    // #given
    const sandbox = makeSandbox();
    seedVault(sandbox);
    writeVaultFile(sandbox, ROUTES_NOTE, "- chronos → [[Gone]]\n");
    const repo = makeRepo(sandbox, "chronos", "main");

    // #when
    const result = pointer(sandbox, repo, { BRAIN_DUMP_POINTER_DEADLINE_MS: "0" });

    // #then
    expect(result).toEqual([0, "", ""]);
  });
});
