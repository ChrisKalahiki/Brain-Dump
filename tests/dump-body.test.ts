import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { makeRepo, makeSandbox, run, writeDumpArgs } from "./harness.ts";

function writeDumpWithBody(body: string) {
  const sandbox = makeSandbox();
  const repo = makeRepo(sandbox, "Brain-Dump", "main");
  const result = run(sandbox, writeDumpArgs(), { stdin: body, cwd: repo });
  const inbox = join(sandbox.vault, "Inbox");
  return { result, written: existsSync(inbox) ? readdirSync(inbox) : [] };
}

describe("brain-dump write-dump body rules", () => {
  test("rejects a Decision without a Why line and writes nothing", () => {
    // #given
    const body = "## Decisions\n- [ ] Use Bun.\n";

    // #when
    const { result, written } = writeDumpWithBody(body);

    // #then
    expect([result.exitCode, result.stderr, written]).toEqual([
      1,
      'brain-dump: invalid Dump body: Decision "Use Bun." has no "\\t- Why:" line\n',
      [],
    ]);
  });

  test("rejects a section other than Learnings, Decisions and Todos", () => {
    // #given
    const body = "## Notes\n- [ ] Something.\n";

    // #when
    const { result } = writeDumpWithBody(body);

    // #then
    expect(result.stderr).toBe('brain-dump: invalid Dump body: unexpected section "## Notes"\n');
  });

  test("rejects a line that is not a checkbox Item", () => {
    // #given
    const body = "## Learnings\n* Bun is fast.\n";

    // #when
    const { result } = writeDumpWithBody(body);

    // #then
    expect(result.stderr).toBe('brain-dump: invalid Dump body: line 2 is not an Item: "* Bun is fast."\n');
  });

  test("rejects text before the first section", () => {
    // #given
    const body = "# My Dump\n## Learnings\n- [ ] Bun is fast.\n";

    // #when
    const { result } = writeDumpWithBody(body);

    // #then
    expect(result.stderr).toBe('brain-dump: invalid Dump body: line 1 is not an Item: "# My Dump"\n');
  });

  test("rejects an empty section", () => {
    // #given
    const body = "## Learnings\n- [ ] Bun is fast.\n\n## Todos\n";

    // #when
    const { result } = writeDumpWithBody(body);

    // #then
    expect(result.stderr).toBe('brain-dump: invalid Dump body: section "## Todos" has no Items\n');
  });

  test("rejects sections out of order", () => {
    // #given
    const body = "## Todos\n- [ ] #todo Ship it.\n\n## Learnings\n- [ ] Bun is fast.\n";

    // #when
    const { result } = writeDumpWithBody(body);

    // #then
    expect(result.stderr).toBe(
      'brain-dump: invalid Dump body: sections must appear once each, in the order Learnings, Decisions, Todos\n',
    );
  });

  test("rejects a body with no Items", () => {
    // #given
    const body = "\n";

    // #when
    const { result } = writeDumpWithBody(body);

    // #then
    expect(result.stderr).toBe("brain-dump: invalid Dump body: it has no Items\n");
  });

  test("rejects a Todo without #todo", () => {
    // #given
    const body = "## Todos\n- [ ] Ship it.\n";

    // #when
    const { result } = writeDumpWithBody(body);

    // #then
    expect(result.stderr).toBe('brain-dump: invalid Dump body: Todo "Ship it." has no #todo tag\n');
  });

  test("rejects a Why line under a Learning", () => {
    // #given
    const body = "## Learnings\n- [ ] Bun is fast.\n\t- Why: benchmarks.\n";

    // #when
    const { result } = writeDumpWithBody(body);

    // #then
    expect(result.stderr).toBe('brain-dump: invalid Dump body: line 3 is not an Item: "\t- Why: benchmarks."\n');
  });

  test("writes a space-indented Why line with a tab", () => {
    // #given
    const body = "## Decisions\n- [ ] Use Bun.\n    - Why: it runs TypeScript directly.\n";

    // #when
    const { result } = writeDumpWithBody(body);

    // #then
    expect(readFileSync(result.stdout.trim(), "utf8")).toEndWith(
      "## Decisions\n- [ ] Use Bun.\n\t- Why: it runs TypeScript directly.\n",
    );
  });

  test("rejects a section that appears twice", () => {
    // #given
    const body = "## Learnings\n- [ ] One.\n\n## Learnings\n- [ ] Two.\n";

    // #when
    const { result } = writeDumpWithBody(body);

    // #then
    expect(result.stderr).toBe(
      "brain-dump: invalid Dump body: sections must appear once each, in the order Learnings, Decisions, Todos\n",
    );
  });
});
