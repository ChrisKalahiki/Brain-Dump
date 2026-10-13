import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { devOrigin, dumpFile, makeRepo, makeSandbox, ROUTES_NOTE, run, writeConfig, writeVaultFile, type Sandbox } from "./harness.ts";

const NOW = "2026-10-12T09:00";
const ORIGIN = devOrigin("chronos", "2026-10-01T09:00");
const OTHER_ORIGIN = devOrigin("Brain-Dump", "2026-10-02T10:00", { tool: "Codex" });
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
  writeVaultFile(sandbox, OTHER_DUMP, dumpFile(OTHER_ORIGIN, DONE_BODY));
  writeVaultFile(sandbox, "Side Projects/Scheduling.md", `# Scheduling\n${filedItems(5)}`);
  writeVaultFile(sandbox, "Research/Main Notes/Job Queues.md", `# Job Queues\n${filedItems(2)}${filedItems(4, "A Brain-Dump Learning", FROM_OTHER)}`);
  writeVaultFile(sandbox, "Resources/Retries.md", `# Retries\n${filedItems(3)}`);
  writeVaultFile(sandbox, "Resources/Backoff.md", `# Backoff\n${filedItems(1)}`);
  writeVaultFile(sandbox, "Side Projects/Brain-Dump.md", `# Brain-Dump\n${filedItems(9, "A Brain-Dump Learning", FROM_OTHER)}`);
}

type LastSweep = { time: string; written?: number; skipped?: number; unreadable?: number; secretRefused?: number; carriedOver?: number; errors?: number };

/** The run-store file a finished Sweep leaves, holding its summary. */
function writeLastSweep(sandbox: Sandbox, { time, written = 0, skipped = 0, unreadable = 0, secretRefused = 0, carriedOver = 0, errors = 0 }: LastSweep): void {
  const many = <T>(count: number, make: (n: number) => T): T[] => Array.from({ length: count }, (_, n) => make(n));
  const last = {
    time,
    run: written > 0 ? "20261012-040000" : null,
    written: many(written, (n) => ({ session: `w-${n}`, dump: `Inbox/2026-10-11 1500 chronos - w${n}.md` })),
    skipped: many(skipped, (n) => ({ session: `s-${n}` })),
    unreadable: many(unreadable, (n) => ({ file: `${sandbox.home}/.claude/projects/u-${n}.jsonl` })),
    secretRefused: many(secretRefused, (n) => ({ session: `r-${n}`, line: 2, kind: "GitHub token" })),
    carriedOver: many(carriedOver, (n) => ({ session: `c-${n}` })),
    errors: many(errors, (n) => ({ session: `e-${n}`, error: "drafting agent failed (exit 1)" })),
  };
  const folder = join(sandbox.home, ".local", "state", "brain-dump");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "sweep.json"), JSON.stringify({ last, retry: [] }));
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
    writeVaultFile(sandbox, "Inbox/2026-10-06 1300 Brain-Dump - undo.md", dumpFile(OTHER_ORIGIN, OPEN_BODY));
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

  test("adds the last Sweep's line between the notes line and the check count when it wrote Dumps or hit problems in the last 24 hours", () => {
    // #given
    const sandbox = makeSandbox();
    seedVault(sandbox);
    writeVaultFile(sandbox, ROUTES_NOTE, "- chronos → [[Gone]]\n");
    writeLastSweep(sandbox, { time: "2026-10-11T09:30:00.000Z", written: 2, skipped: 4, unreadable: 1, secretRefused: 1, carriedOver: 3, errors: 1 });
    const repo = makeRepo(sandbox, "chronos", "main");

    // #when
    const result = pointer(sandbox, repo);

    // #then
    expect(result).toEqual([
      0,
      "brain-dump: Vault notes for chronos: [[Scheduling]] (5 Items), [[Retries]] (3 Items), [[Job Queues]] (2 Items) · use the recall skill for more\n" +
        "brain-dump: last Sweep: 2 Dumps written to the Inbox, 1 unreadable log, 1 draft refused for a secret, 1 error, 3 carried over (run brain-dump sweep --last)\n" +
        "brain-dump: 1 Vault finding (run brain-dump check)\n",
      "",
    ]);
  });

  test("names a Sweep that only hit a problem, in a repo the Vault knows nothing about", () => {
    // #given
    const sandbox = makeSandbox();
    writeLastSweep(sandbox, { time: "2026-10-12T04:00:00.000Z", skipped: 2, unreadable: 2 });
    const repo = makeRepo(sandbox, "unrelated", "main");

    // #when
    const result = pointer(sandbox, repo);

    // #then
    expect(result).toEqual([0, "brain-dump: last Sweep: 2 unreadable logs (run brain-dump sweep --last)\n", ""]);
  });

  test("says nothing of a Sweep that wrote nothing and hit no problem", () => {
    // #given
    const sandbox = makeSandbox();
    writeLastSweep(sandbox, { time: "2026-10-12T04:00:00.000Z", skipped: 3 });
    const repo = makeRepo(sandbox, "unrelated", "main");

    // #when
    const result = pointer(sandbox, repo);

    // #then
    expect(result).toEqual([0, "", ""]);
  });

  test("says nothing of a Sweep more than 24 hours old", () => {
    // #given
    const sandbox = makeSandbox();
    writeLastSweep(sandbox, { time: "2026-10-11T08:59:00.000Z", written: 2, errors: 1 });
    const repo = makeRepo(sandbox, "unrelated", "main");

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
    writeLastSweep(sandbox, { time: "2026-10-12T04:00:00.000Z", written: 1, errors: 1 });
    const repo = makeRepo(sandbox, "chronos", "main");

    // #when
    const result = pointer(sandbox, repo, { BRAIN_DUMP_POINTER_DEADLINE_MS: "0" });

    // #then
    expect(result).toEqual([0, "", ""]);
  });
});
