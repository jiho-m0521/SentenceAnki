import { describe, expect, it } from "vitest";
import { compareAnswer, defaultSettings, diffAnswer, gradePrompt, makePrompt, nextReviewDate, orderSentences, updateReviewState } from "./study";
import type { Sentence, StudyRecord } from "./types";

const baseSentence: Sentence = {
  id: "sentence_1",
  deckId: "deck_1",
  english: 'When feeling down, saying "I am really sad" is more helpful.',
  korean: "기분이 우울할 때는 나는 정말 슬프다고 말하는 것이 더 도움이 된다.",
  selected: false,
  tags: [],
  archived: false,
  orderIndex: 1,
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
    expect(compareAnswer("italian food", "Italian Food.", defaultSettings.grading)).toBe(true);
  });

  it("allows small typos when enabled", () => {
    expect(compareAnswer("Italin Food", "Italian Food", { ...defaultSettings.grading, allowTypo: true })).toBe(true);
  });

  it("returns a wrong result and diff when a blank answer does not match", () => {
    const prompt = makePrompt({ ...baseSentence, english: "Welcome to Italian Food." }, 3);
    const result = gradePrompt(
      prompt,
      prompt.blanks.map(() => "wrong"),
      defaultSettings.grading,
      Date.now(),
    );
    expect(result.isCorrect).toBe(false);
    expect(result.correctAnswer).not.toBe("");
    expect(result.diff.length).toBeGreaterThan(0);
  });

  it("keeps ordered study order stable", () => {
    const sentences = [
      { ...baseSentence, id: "a", orderIndex: 1 },
      { ...baseSentence, id: "b", orderIndex: 2 },
    ];
    expect(orderSentences(sentences, "ordered").map((sentence) => sentence.id)).toEqual(["a", "b"]);
  });

  it("calculates later review dates for correct answers", () => {
    expect(nextReviewDate(3, true)).toBeTypeOf("string");
    expect(new Date(nextReviewDate(3, true)).getTime()).toBeGreaterThan(Date.now());
  });

  it("updates review state from study records", () => {
    const record: StudyRecord = {
      id: "record_1",
      deckId: "deck_1",
      sentenceId: "sentence_1",
      sessionId: "session_1",
      answer: "Welcome",
      correctAnswer: "Welcome",
      isCorrect: true,
      forcedCorrect: false,
      difficulty: 3,
      blankMode: "random",
      responseMs: 1200,
      studiedAt: "2026-01-01T00:00:00.000Z",
    };
    const state = updateReviewState(undefined, record);
    expect(state.attempts).toBe(1);
    expect(state.correctAttempts).toBe(1);
    expect(state.streak).toBe(1);
  });

  it("creates answer diff parts", () => {
    expect(diffAnswer("Italian Foo", "Italian Food").some((part) => part.type === "changed")).toBe(true);
  });
});
