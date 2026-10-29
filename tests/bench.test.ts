import { describe, expect, test } from "bun:test";
import { parseGenerated, parseQuestions, renderQuestion } from "../evals/bench-questions.ts";
import { answerLinks, score } from "../evals/bench-score.ts";

describe("bench questions", () => {
  test("each line is a question and the Section or note that answers it; blank lines are skipped and malformed ones reported by line", () => {
    // #given
    const text = [
      "Why did we pick WAL mode? → [[SQLite#Journal modes]]",
      "",
      "Which note covers retries? → [[Research/Main Notes/Networking]]",
      "No arrow on this line [[SQLite]]",
      "→ [[SQLite#Locks]]",
      "What is A → B? → SQLite#Locks",
      "Arrows in the question → still work? → [[SQLite#Locks|alias]]",
    ].join("\n");

    // #when
    const parsed = parseQuestions(text);

    // #then
    expect(parsed).toEqual({
      questions: [
        { line: 1, question: "Why did we pick WAL mode?", gold: "[[SQLite#Journal modes]]" },
        { line: 3, question: "Which note covers retries?", gold: "[[Research/Main Notes/Networking]]" },
        { line: 7, question: "Arrows in the question → still work?", gold: "[[SQLite#Locks|alias]]" },
      ],
      malformed: [
        { line: 4, error: "no → between the question and its [[Note#Section]]" },
        { line: 5, error: "no question before →" },
        { line: 6, error: "after → comes SQLite#Locks, not one [[Note#Section]]" },
      ],
    });
  });

  test("a generated question is written on one line that reads back as the same question and gold", () => {
    // #given
    const written = renderQuestion("How does SQLite\nhandle → concurrent writers?", "[[Research/Main Notes/SQLite#Locks]]");

    // #when
    const parsed = parseQuestions(written);

    // #then
    expect(parsed.questions).toEqual([{ line: 1, question: "How does SQLite handle → concurrent writers?", gold: "[[Research/Main Notes/SQLite#Locks]]" }]);
  });

  test("the generator's reply gives each numbered Item or Section its questions, ignoring other lines", () => {
    // #given
    const reply = ["Here are the questions:", "I1: Why was the cache dropped?", "S2: How are writers kept apart?", "- S2:  What stops two writes at once? ", "S9 no colon", "I1: A second one"].join("\n");

    // #when
    const generated = parseGenerated(reply);

    // #then
    expect(Object.fromEntries(generated)).toEqual({
      I1: ["Why was the cache dropped?", "A second one"],
      S2: ["How are writers kept apart?", "What stops two writes at once?"],
    });
  });
});

describe("bench scoring", () => {
  const locks = { note: "Main/SQLite.md", section: "[[SQLite#Locks]]" };
  const journal = { note: "Main/SQLite.md", section: "[[SQLite#Journal modes]]" };
  const retries = { note: "Main/Networking.md", section: "[[Networking#Retries]]" };

  test("Recall@1 counts golds answered first and Recall@3 golds among the first three; a Section gold needs that Section, a note gold any part of the note", () => {
    // #given
    const answered = [
      { gold: locks, answers: [locks, journal], outlineChars: 100 },
      { gold: locks, answers: [retries, journal, locks, locks], outlineChars: 100 },
      { gold: locks, answers: [journal, retries, retries, locks], outlineChars: 100 },
      { gold: { note: "Main/SQLite.md", section: null }, answers: [journal], outlineChars: 100 },
    ];

    // #when
    const scored = score(answered);

    // #then
    expect({ recallAt1: scored.recallAt1, recallAt3: scored.recallAt3 }).toEqual({ recallAt1: 0.5, recallAt3: 0.75 });
  });

  test("the invented share is the answers show refused over all answers given, and Outline characters are the mean and most sent per question", () => {
    // #given
    const answered = [
      { gold: locks, answers: ["refused" as const, locks], outlineChars: 1_000 },
      { gold: locks, answers: ["refused" as const, "refused" as const, journal], outlineChars: 3_000 },
      { gold: retries, answers: [], outlineChars: 2_000 },
    ];

    // #when
    const scored = score(answered);

    // #then
    expect({ questions: scored.questions, invented: scored.invented, outlineChars: scored.outlineChars }).toEqual({
      questions: 3,
      invented: 0.6,
      outlineChars: { mean: 2_000, max: 3_000 },
    });
  });

  test("no questions score zero rather than dividing by zero", () => {
    // #when
    const scored = score([]);

    // #then
    expect(scored).toEqual({ questions: 0, recallAt1: 0, recallAt3: 0, invented: 0, outlineChars: { mean: 0, max: 0 } });
  });

  test("a reply's answers are its distinct [[Note#Section]] links in order, at most three", () => {
    // #given
    const reply = "1. [[SQLite#Locks]]\n2. [[SQLite#Locks]] again\nalso [[Networking#Retries|retries]] and [[A#B]], [[C#D]]";

    // #when
    const links = answerLinks(reply);

    // #then
    expect(links).toEqual(["[[SQLite#Locks]]", "[[Networking#Retries|retries]]", "[[A#B]]"]);
  });
});
