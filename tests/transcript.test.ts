import { afterEach, describe, expect, test } from "bun:test";
import { parseSessionText, renderSessionText, type SessionMessage } from "../src/transcript.ts";

const zone = process.env.TZ;

// `bun test` runs in UTC with TZ unset; unsetting it after a change would fall back to the machine's zone, not UTC.
afterEach(() => {
  process.env.TZ = zone ?? "UTC";
});

describe("the Session text form", () => {
  test("writes each message's time in local time and reads it back as local time", () => {
    // #given
    process.env.TZ = "America/New_York";
    const messages: SessionMessage[] = [
      { role: "user", text: "Question 1", at: new Date("2026-10-11T19:00:00Z") },
      { role: "assistant", text: "Answer 1", at: new Date("2026-10-11T19:01:00Z") },
    ];

    // #when
    const text = renderSessionText(messages);

    // #then
    expect({ text, back: parseSessionText(text) }).toEqual({ text: "[2026-10-11 15:00] User:\nQuestion 1\n\n[2026-10-11 15:01] Assistant:\nAnswer 1", back: messages });
  });

  test("round-trips text spanning several lines and paragraphs", () => {
    // #given
    const messages: SessionMessage[] = [
      { role: "user", text: "First line\nsecond line\n\nA new paragraph.", at: new Date("2026-10-11T15:00:00Z") },
      { role: "assistant", text: "```sh\nbun test\n```", at: new Date("2026-10-11T15:01:00Z") },
    ];

    // #when
    const back = parseSessionText(renderSessionText(messages));

    // #then
    expect(back).toEqual(messages);
  });
});
