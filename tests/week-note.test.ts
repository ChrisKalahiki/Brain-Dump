import { describe, expect, test } from "bun:test";
import { makeSandbox, run, writeVaultFile } from "./harness.ts";

const WEEKLY = "Research/Weekly Meetings";

describe("brain-dump week-note", () => {
  test("finds the latest Weekly Note dated within the 7 days up to the date, even one made on a Tuesday", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, `${WEEKLY}/09-28-26 Weekly Update.md`, "");
    writeVaultFile(sandbox, `${WEEKLY}/10-06-26 Weekly Update.md`, "");
    writeVaultFile(sandbox, `${WEEKLY}/10-09-26 Weekly Update.md`, "");

    // #when
    const result = run(sandbox, ["week-note", "--date", "2026-10-08"]);

    // #then
    expect(JSON.parse(result.stdout)).toEqual({ exists: true, note: `${WEEKLY}/10-06-26 Weekly Update.md` });
  });

  test("reports the Monday-named note that would be created when the week has none", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, `${WEEKLY}/10-05-26 Weekly Update.md`, "");

    // #when
    const result = run(sandbox, ["week-note", "--date", "2026-10-14"]);

    // #then
    expect(JSON.parse(result.stdout)).toEqual({ exists: false, note: `${WEEKLY}/10-12-26 Weekly Update.md` });
  });
});
