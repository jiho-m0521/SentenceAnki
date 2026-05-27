import type { Sentence, StudyPrompt, StudyResult } from "./types";

const wordPattern = /[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu;

export function normalizeAnswer(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[“”"]/g, "")
    .replace(/[.,!?;:()\[\]{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function compareAnswer(answer: string, correctAnswer: string) {
  return normalizeAnswer(answer) === normalizeAnswer(correctAnswer);
}

export function makePrompt(sentence: Sentence, difficulty: number): StudyPrompt {
  const words = Array.from(sentence.english.matchAll(wordPattern)).map((match, index) => ({
    index,
    value: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));

  if (words.length === 0) {
    return {
      sentence,
      blanks: [{ index: 0, answer: sentence.english }],
      parts: [{ type: "blank", index: 0, answer: sentence.english }],
    };
  }

  const ratio = [0.18, 0.28, 0.42, 0.58, 0.75][Math.max(1, Math.min(5, difficulty)) - 1];
  const blankCount = Math.max(1, Math.min(words.length, Math.round(words.length * ratio)));
  const step = Math.max(1, Math.floor(words.length / blankCount));
  const selected = new Set<number>();

  for (let i = words.length - 1; i >= 0 && selected.size < blankCount; i -= step) {
    selected.add(words[i].index);
  }
  for (let i = 0; selected.size < blankCount && i < words.length; i += 1) {
    selected.add(words[i].index);
  }

  const blanks = words
    .filter((word) => selected.has(word.index))
    .map((word, blankIndex) => ({ index: blankIndex, answer: word.value, word }));

  const parts: StudyPrompt["parts"] = [];
  let cursor = 0;
  for (const blank of blanks) {
    if (blank.word.start > cursor) {
      parts.push({ type: "text", value: sentence.english.slice(cursor, blank.word.start) });
    }
    parts.push({ type: "blank", index: blank.index, answer: blank.answer });
    cursor = blank.word.end;
  }
  if (cursor < sentence.english.length) {
    parts.push({ type: "text", value: sentence.english.slice(cursor) });
  }

  return {
    sentence,
    blanks: blanks.map(({ index, answer }) => ({ index, answer })),
    parts,
  };
}

export function getCorrectAnswer(prompt: StudyPrompt) {
  return prompt.blanks.map((blank) => blank.answer).join(" / ");
}

export function gradePrompt(prompt: StudyPrompt, answers: string[]): StudyResult {
  const correctAnswer = getCorrectAnswer(prompt);
  const answer = answers.map((value) => value.trim()).join(" / ");
  const isCorrect =
    answers.length === prompt.blanks.length &&
    prompt.blanks.every((blank, index) => compareAnswer(answers[index] ?? "", blank.answer));

  return {
    sentenceId: prompt.sentence.id,
    answer,
    correctAnswer,
    isCorrect,
    forcedCorrect: false,
    completedAt: new Date().toISOString(),
  };
}

export function orderSentences(sentences: Sentence[], mode: "ordered" | "random") {
  if (mode === "ordered") return [...sentences];
  return [...sentences]
    .map((sentence) => ({ sentence, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map((entry) => entry.sentence);
}
