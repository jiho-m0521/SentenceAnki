import { describe, expect, it } from "vitest";
import { compareAnswer, gradePrompt, makePrompt, orderSentences } from "./study";
import type { Sentence } from "./types";

const baseSentence: Sentence = {
  id: "sentence_1",
  deckId: "deck_1",
  english: 'When feeling down, saying "I am really sad" is more helpful.',
  korean: "기분이 우울할 때는 나는 정말 슬프다고 말하는 것이 더 도움이 된다.",
  selected: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("study prompt generation", () => {
  it("creates more blanks as difficulty rises", () => {
    const easy = makePrompt(baseSentence, 1);
    const hard = makePrompt(baseSentence, 5);

    expect(easy.blanks.length).toBeGreaterThanOrEqual(1);
    expect(hard.blanks.length).toBeGreaterThan(easy.blanks.length);
  });

  it("keeps at least one blank for a short sentence", () => {
    const prompt = makePrompt({ ...baseSentence, english: "Yes." }, 1);

    expect(prompt.blanks).toHaveLength(1);
    expect(prompt.blanks[0].answer).toBe("Yes");
  });

  it("grades answers while ignoring case and punctuation", () => {
    expect(compareAnswer("italian food", "Italian Food.")).toBe(true);
  });

  it("returns a wrong result when a blank answer does not match", () => {
    const prompt = makePrompt({ ...baseSentence, english: "Welcome to Italian Food." }, 3);
    const result = gradePrompt(
      prompt,
      prompt.blanks.map(() => "wrong"),
    );

    expect(result.isCorrect).toBe(false);
    expect(result.correctAnswer).not.toBe("");
  });

  it("keeps ordered study order stable", () => {
    const sentences = [
      { ...baseSentence, id: "a" },
      { ...baseSentence, id: "b" },
    ];

    expect(orderSentences(sentences, "ordered").map((sentence) => sentence.id)).toEqual(["a", "b"]);
  });
});
