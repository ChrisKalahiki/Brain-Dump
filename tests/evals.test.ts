import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EVALS, inputHash, staleEvals } from "../evals/eval.ts";

describe("prompt evals", () => {
  test("an eval's input hash changes when any input or the model changes, and only then", () => {
    // #given
    const folder = mkdtempSync(join(tmpdir(), "brain-dump-eval-"));
    const [prompt, fixture] = [join(folder, "prompt.md"), join(folder, "fixture.txt")];
    writeFileSync(prompt, "Draft a Dump.\n");
    writeFileSync(fixture, "User: hi\n");
    const declared = { inputs: [prompt, fixture], model: "model-a" };
    const before = inputHash(declared);

    // #when
    const unchanged = inputHash(declared);
    writeFileSync(fixture, "User: hello\n");
    const fixtureChanged = inputHash(declared);
    const modelChanged = inputHash({ ...declared, model: "model-b" });

    // #then
    expect({ unchanged: unchanged === before, fixtureChanged: fixtureChanged !== before, modelChanged: modelChanged !== fixtureChanged }).toEqual({
      unchanged: true,
      fixtureChanged: true,
      modelChanged: true,
    });
  });

  test("an eval whose inputs changed since its recorded pass is stale, naming the command to run", () => {
    // #given
    const folder = mkdtempSync(join(tmpdir(), "brain-dump-eval-"));
    const prompt = join(folder, "prompt.md");
    writeFileSync(prompt, "Draft a Dump.\n");
    const declared = { name: "toy", inputs: [prompt], model: "model-a" };
    const passed = { toy: { hash: inputHash(declared), date: "2026-10-12", model: "model-a" } };

    // #when
    const fresh = staleEvals([declared], passed);
    writeFileSync(prompt, "Draft a better Dump.\n");
    const changed = staleEvals([declared], passed);
    const neverPassed = staleEvals([declared], {});

    // #then
    expect({ fresh, changed, neverPassed }).toEqual({
      fresh: [],
      changed: ["toy: inputs changed since the pass recorded on 2026-10-12; run `bun run eval toy`"],
      neverPassed: ["toy: no pass recorded; run `bun run eval toy`"],
    });
  });

  test("every eval has a pass recorded against its current inputs", () => {
    // #given
    const evals = EVALS;

    // #when
    const stale = staleEvals(evals);

    // #then
    expect(stale).toEqual([]);
  });
});
