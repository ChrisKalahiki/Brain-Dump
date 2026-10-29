import { describe, expect, test } from "bun:test";
import { bm25 } from "../src/bm25.ts";

const rounded = (scores: number[]): number[] => scores.map((score) => Number(score.toFixed(5)));

describe("bm25", () => {
  test("scores each document with k1 1.2, b 0.75 and idf ln(1 + (N - n + 0.5) / (n + 0.5))", () => {
    // #given
    const documents = [
      ["a", "b"],
      ["b", "b", "c"],
    ];

    // #when
    const rare = bm25(documents, ["a"]);
    const common = bm25(documents, ["b"]);

    // #then
    expect([rounded(rare), rounded(common)]).toEqual([
      [0.75491, 0],
      [0.19857, 0.23734],
    ]);
  });

  test("sums over distinct query terms, so repeating one counts once", () => {
    // #given
    const documents = [["a", "b"], ["c"]];

    // #when
    const once = bm25(documents, ["a", "b"]);
    const repeated = bm25(documents, ["a", "a", "b"]);

    // #then
    expect(repeated).toEqual(once);
  });

  test("scores nothing in an empty corpus", () => {
    // #when
    const scores = bm25([], ["a"]);

    // #then
    expect(scores).toEqual([]);
  });
});
