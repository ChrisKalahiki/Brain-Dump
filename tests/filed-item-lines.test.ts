import { describe, expect, test } from "bun:test";
import { BACKLINK_LINE, curatedBullets, itemKey, renderFiledItem, renderLinkLine, TODO_TAG } from "../src/curated.ts";

const DUMP = { title: "2026-10-05 1940 Brain-Dump - filing", date: "2026-10-05" };

describe("filed-Item lines", () => {
  test("renders each kind as Filing appends it", () => {
    // #given
    const items = [
      { kind: "Todo" as const, text: "#todo Ship the file skill.", rationale: null },
      { kind: "Learning" as const, text: "Codex reads ~/.agents/skills.", rationale: null },
      { kind: "Decision" as const, text: "Filing is append-only.", rationale: "undo stays exact." },
    ];

    // #when
    const rendered = items.map((item) => renderFiledItem(item, DUMP));

    // #then
    expect(rendered).toEqual([
      ["- [ ] Ship the file skill. #todo"],
      ["- Codex reads ~/.agents/skills.", "\t- From [[2026-10-05 1940 Brain-Dump - filing|dump 10-05-26]]"],
      ["- Filing is append-only.", "\t- Why: undo stays exact.", "\t- From [[2026-10-05 1940 Brain-Dump - filing|dump 10-05-26]]"],
    ]);
  });

  test("moves #todo to the end of a Todo's text wherever it stands, and adds it when edited text has none", () => {
    // #given
    const texts = ["#todo Ship it.", "Ship #todo it.", "Ship it. #todo", "Ship it."];

    // #when
    const rendered = texts.map((text) => renderFiledItem({ kind: "Todo", text, rationale: null }, DUMP));

    // #then
    expect(rendered).toEqual(texts.map(() => ["- [ ] Ship it. #todo"]));
  });

  test("reads back what it writes, for an Item's own wording and edited wording: its text, Why and Dump, as Recall, check and duplicates see them", () => {
    // #given
    const items = [
      { kind: "Todo" as const, text: "#todo Ship the file skill.", rationale: null },
      { kind: "Learning" as const, text: "Codex reads ~/.agents/skills.", rationale: null },
      { kind: "Decision" as const, text: "Filing is append-only.", rationale: "undo stays exact." },
      { kind: "Todo" as const, text: "Ship the #todo skill by Friday", rationale: null },
      { kind: "Learning" as const, text: "Codex reads skills from `~/.agents` [[Agent Skills]] too", rationale: null },
      { kind: "Decision" as const, text: "Keep filing append-only, even for Digests", rationale: "undo stays exact." },
    ];

    // #when
    const read = items.map((item) => {
      const [bullet] = curatedBullets(["# Note", ...renderFiledItem(item, DUMP)]);
      return bullet && { key: itemKey(bullet.text), todo: TODO_TAG.test(bullet.text), why: bullet.why ?? null, from: bullet.from ?? null };
    });

    // #then
    expect(read).toEqual([
      { key: itemKey(items[0]?.text ?? ""), todo: true, why: null, from: null },
      { key: itemKey(items[1]?.text ?? ""), todo: false, why: null, from: DUMP.title },
      { key: itemKey(items[2]?.text ?? ""), todo: false, why: "undo stays exact.", from: DUMP.title },
      { key: itemKey(items[3]?.text ?? ""), todo: true, why: null, from: null },
      { key: itemKey(items[4]?.text ?? ""), todo: false, why: null, from: DUMP.title },
      { key: itemKey(items[5]?.text ?? ""), todo: false, why: "undo stays exact.", from: DUMP.title },
    ]);
  });

  test("reads back the link line it writes", () => {
    // #given
    const line = renderLinkLine({ title: DUMP.title, label: "ClaudeWeb", slug: "filing" });

    // #when
    const link = BACKLINK_LINE.exec(line)?.[1];

    // #then
    expect([line, link]).toEqual(["- Filed [[2026-10-05 1940 Brain-Dump - filing|ClaudeWeb filing]]", `${DUMP.title}|ClaudeWeb filing`]);
  });
});
