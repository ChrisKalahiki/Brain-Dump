import { describe, expect, test } from "bun:test";
import { makeSandbox, run, writeVaultFile } from "./harness.ts";

describe("brain-dump routes", () => {
  test("reads each '<key> → [[note]]' line of the Routes note, ignoring other lines", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(
      sandbox,
      "Inbox/Filing Routes.md",
      "# Filing Routes\n\ncontext-bridge → [[Context Bridge MCP Main Note]]\nAgent Skills → [[Agent Skills|skills]]\nnot a route\n",
    );

    // #when
    const result = run(sandbox, ["routes"]);

    // #then
    expect(JSON.parse(result.stdout)).toEqual([
      { key: "context-bridge", title: "Context Bridge MCP Main Note" },
      { key: "Agent Skills", title: "Agent Skills" },
    ]);
  });

  test("prints an empty list when there is no Routes note", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = run(sandbox, ["routes"]);

    // #then
    expect(JSON.parse(result.stdout)).toEqual([]);
  });

  test("reads a Route to a Todo Group, telling it apart from a Route to a note", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, "Inbox/Filing Routes.md", "Brain-Dump → [[Brain-Dump]]\n- Byzantine Agents → To-Do › Dissertation › Agents\n");

    // #when
    const result = run(sandbox, ["routes"]);

    // #then
    expect(JSON.parse(result.stdout)).toEqual([
      { key: "Brain-Dump", title: "Brain-Dump" },
      { key: "Byzantine Agents", group: ["Dissertation", "Agents"] },
    ]);
  });

  test("reads a Route written as a bullet", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, "Inbox/Filing Routes.md", "- Brain-Dump → [[Brain-Dump]]\n");

    // #when
    const result = run(sandbox, ["routes"]);

    // #then
    expect(JSON.parse(result.stdout)).toEqual([{ key: "Brain-Dump", title: "Brain-Dump" }]);
  });
});
