import type {
  AnswerDiffPart,
  AppSettings,
  BlankMode,
  GradingOptions,
  LearningStats,
  ReviewState,
  Sentence,
  StudyPrompt,
  StudyRecord,
  StudyResult,
} from "./types";

const wordPattern = /[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu;
const importantWords = new Set([
  "am",
  "are",
  "is",
  "was",
  "were",
  "have",
  "has",
  "had",
  "would",
  "could",
  "should",
  "want",
  "like",
  "order",
  "please",
  "because",
  "before",
  "after",
]);

export const defaultSettings: AppSettings = {
  id: "default",
  grading: {
    ignoreCase: true,
    ignorePunctuation: true,
    normalizeWhitespace: true,
    allowTypo: false,
  },
  blankMode: "random",
  studyScreen: {
    autoAdvanceCorrect: true,
    showHintButton: true,
    manualNextAfterWrong: true,
  },
  autoDifficulty: true,
  dailyGoal: 20,
  deckAppearanceDefaults: {
    color: "#2563eb",
    icon: "book",
  },
  defaultExportIncludesHistory: false,
  automaticBackup: false,
  updatedAt: new Date().toISOString(),
};

export function normalizeAnswer(value: string, options: GradingOptions = defaultSettings.grading) {
  let output = value;
  if (options.ignoreCase) output = output.toLocaleLowerCase();
  output = output.replace(/[“”"]/g, "");
  if (options.ignorePunctuation) output = output.replace(/[.,!?;:()[\]{}]/g, "");
  if (options.normalizeWhitespace) output = output.replace(/\s+/g, " ");
  return output.trim();
}

function levenshtein(a: string, b: string) {
  const rows = Array.from({ length: a.length + 1 }, (_, index) => [index]);
  for (let column = 1; column <= b.length; column += 1) rows[0][column] = column;
  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      rows[row][column] =
        a[row - 1] === b[column - 1]
          ? rows[row - 1][column - 1]
          : Math.min(rows[row - 1][column - 1], rows[row][column - 1], rows[row - 1][column]) + 1;
    }
  }
  return rows[a.length][b.length];
}

export function compareAnswer(answer: string, correctAnswer: string, options: GradingOptions = defaultSettings.grading) {
  const normalizedAnswer = normalizeAnswer(answer, options);
  const normalizedCorrect = normalizeAnswer(correctAnswer, options);
  if (normalizedAnswer === normalizedCorrect) return true;
  if (!options.allowTypo || normalizedCorrect.length < 5) return false;
  return levenshtein(normalizedAnswer, normalizedCorrect) <= Math.max(1, Math.floor(normalizedCorrect.length * 0.16));
}

function wordsFrom(sentence: string) {
  return Array.from(sentence.matchAll(wordPattern)).map((match, index) => ({
    index,
    value: match[0],
    normalized: match[0].toLocaleLowerCase(),
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

function pickBlankWords(sentence: Sentence, difficulty: number, blankMode: BlankMode, weakWords: string[] = []) {
  const words = wordsFrom(sentence.english);
  if (words.length === 0) return [];
  const ratio = [0.18, 0.28, 0.42, 0.58, 0.75][Math.max(1, Math.min(5, difficulty)) - 1];
  const blankCount = Math.max(1, Math.min(words.length, Math.round(words.length * ratio)));
  const weak = new Set(weakWords.map((word) => word.toLocaleLowerCase()));
  const scored = words.map((word, position) => {
    const isLong = word.value.length >= 6 ? 2 : 0;
    const isImportant = importantWords.has(word.normalized) ? 3 : 0;
    const isWeak = weak.has(word.normalized) ? 5 : 0;
    const phraseWeight = position % 3 === 1 ? 2 : 0;
    const randomWeight = Math.sin((position + 1) * 9301 + sentence.id.length * 49297);
    const modeWeight =
      blankMode === "important" ? isImportant + isLong : blankMode === "weak" ? isWeak + isImportant : blankMode === "phrase" ? phraseWeight + isLong : randomWeight;
    return { word, score: modeWeight + randomWeight / 10 };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, blankCount)
    .map((entry) => entry.word)
    .sort((a, b) => a.start - b.start);
}

export function makePrompt(sentence: Sentence, difficulty: number, blankMode: BlankMode = "random", weakWords: string[] = []): StudyPrompt {
  const boundedDifficulty = clampDifficulty(difficulty);
  const selectedWords = pickBlankWords(sentence, boundedDifficulty, blankMode, weakWords);

  if (selectedWords.length === 0) {
    return {
      sentence,
      difficulty: boundedDifficulty,
      blanks: [{ index: 0, answer: sentence.english, hint: sentence.english.slice(0, 1) }],
      parts: [{ type: "blank", index: 0, answer: sentence.english, hint: sentence.english.slice(0, 1) }],
    };
  }

  const blanks = selectedWords.map((word, index) => ({ index, answer: word.value, hint: `${word.value[0] ?? ""}${"_".repeat(Math.max(0, word.value.length - 1))}`, word }));
  const parts: StudyPrompt["parts"] = [];
  let cursor = 0;
  for (const blank of blanks) {
    if (blank.word.start > cursor) parts.push({ type: "text", value: sentence.english.slice(cursor, blank.word.start) });
    parts.push({ type: "blank", index: blank.index, answer: blank.answer, hint: blank.hint });
    cursor = blank.word.end;
  }
  if (cursor < sentence.english.length) parts.push({ type: "text", value: sentence.english.slice(cursor) });
  return { sentence, difficulty: boundedDifficulty, blanks: blanks.map(({ index, answer, hint }) => ({ index, answer, hint })), parts };
}

export function getCorrectAnswer(prompt: StudyPrompt) {
  return prompt.blanks.map((blank) => blank.answer).join(" / ");
}

export function diffAnswer(answer: string, correctAnswer: string): AnswerDiffPart[] {
  const answerWords = answer.split(/\s+/).filter(Boolean);
  const correctWords = correctAnswer.split(/\s+/).filter(Boolean);
  const max = Math.max(answerWords.length, correctWords.length);
  const parts: AnswerDiffPart[] = [];
  for (let index = 0; index < max; index += 1) {
    const actual = answerWords[index];
    const expected = correctWords[index];
    if (actual === expected && actual) parts.push({ type: "same", value: actual });
    else if (actual && expected) parts.push({ type: "changed", value: `${actual} → ${expected}` });
    else if (expected) parts.push({ type: "missing", value: expected });
    else if (actual) parts.push({ type: "extra", value: actual });
  }
  return parts;
}

export function gradePrompt(prompt: StudyPrompt, answers: string[], options: GradingOptions, startedAt: number): StudyResult {
  const correctAnswer = getCorrectAnswer(prompt);
  const answer = answers.map((value) => value.trim()).join(" / ");
  const isCorrect =
    answers.length === prompt.blanks.length &&
    prompt.blanks.every((blank, index) => compareAnswer(answers[index] ?? "", blank.answer, options));

  return {
    sentenceId: prompt.sentence.id,
    answer,
    correctAnswer,
    isCorrect,
    forcedCorrect: false,
    completedAt: new Date().toISOString(),
    responseMs: Math.max(0, Date.now() - startedAt),
    diff: diffAnswer(answer, correctAnswer),
  };
}

export function orderSentences(sentences: Sentence[], mode: "ordered" | "random" | "srs", reviewStates: ReviewState[] = []) {
  if (mode === "ordered") return [...sentences].sort((a, b) => a.orderIndex - b.orderIndex || a.createdAt.localeCompare(b.createdAt));
  if (mode === "random") return [...sentences].map((sentence) => ({ sentence, sort: Math.random() })).sort((a, b) => a.sort - b.sort).map((entry) => entry.sentence);
  const reviewBySentence = new Map(reviewStates.map((state) => [state.sentenceId, state]));
  return [...sentences].sort((a, b) => {
    const stateA = reviewBySentence.get(a.id);
    const stateB = reviewBySentence.get(b.id);
    const dueA = stateA?.nextReviewAt ?? "1970-01-01T00:00:00.000Z";
    const dueB = stateB?.nextReviewAt ?? "1970-01-01T00:00:00.000Z";
    const weakA = stateA?.lastWrong ? -1 : 0;
    const weakB = stateB?.lastWrong ? -1 : 0;
    return weakA - weakB || dueA.localeCompare(dueB);
  });
}

export function nextReviewDate(srsLevel: number, correct: boolean) {
  const days = correct ? [0, 1, 3, 7, 14, 30, 60][Math.min(6, Math.max(0, srsLevel))] : 0;
  const next = new Date();
  next.setDate(next.getDate() + days);
  return next.toISOString();
}

export function updateReviewState(previous: ReviewState | undefined, record: StudyRecord): ReviewState {
  const timestamp = record.studiedAt;
  const attempts = (previous?.attempts ?? 0) + 1;
  const correctAttempts = (previous?.correctAttempts ?? 0) + (record.isCorrect ? 1 : 0);
  const streak = record.isCorrect ? (previous?.streak ?? 0) + 1 : 0;
  const srsLevel = record.isCorrect ? Math.min(6, (previous?.srsLevel ?? 0) + 1) : Math.max(0, (previous?.srsLevel ?? 0) - 1);
  return {
    id: previous?.id ?? `review_${record.sentenceId}`,
    deckId: record.deckId,
    sentenceId: record.sentenceId,
    attempts,
    correctAttempts,
    streak,
    srsLevel,
    nextReviewAt: nextReviewDate(srsLevel, record.isCorrect),
    lastStudiedAt: timestamp,
    lastWrong: !record.isCorrect,
    updatedAt: timestamp,
  };
}

export function extractWeakWords(records: StudyRecord[], sentences: Sentence[]) {
  const sentenceMap = new Map(sentences.map((sentence) => [sentence.id, sentence]));
  return records
    .filter((record) => !record.isCorrect)
    .flatMap((record) => wordsFrom(sentenceMap.get(record.sentenceId)?.english ?? "").map((word) => word.normalized))
    .slice(-80);
}

export function clampDifficulty(value: number) {
  return Math.max(1, Math.min(5, Math.round(value)));
}

export function recommendDifficulty(baseDifficulty: number, review: ReviewState | undefined) {
  const base = clampDifficulty(baseDifficulty);
  if (!review || review.attempts === 0) return base;
  const accuracy = review.correctAttempts / Math.max(1, review.attempts);
  if (review.lastWrong || accuracy < 0.7) return clampDifficulty(base + 1);
  if (review.streak >= 3) return clampDifficulty(base - 1);
  return base;
}

function localDayKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function calculateLearningStats(records: StudyRecord[], dailyGoal: number, now = new Date()): LearningStats {
  const todayKey = localDayKey(now.toISOString());
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const dayKeys = new Set(records.map((record) => localDayKey(record.studiedAt)));
  let streakDays = 0;
  const cursor = new Date(now);
  cursor.setHours(12, 0, 0, 0);
  while (dayKeys.has(localDayKey(cursor.toISOString()))) {
    streakDays += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  const weeklyRecords = records.filter((record) => new Date(record.studiedAt) >= weekStart);
  const weeklyAccuracy = weeklyRecords.length === 0 ? 0 : Math.round((weeklyRecords.filter((record) => record.isCorrect).length / weeklyRecords.length) * 100);
  return {
    todayStudied: records.filter((record) => localDayKey(record.studiedAt) === todayKey).length,
    dailyGoal: Math.max(1, dailyGoal || 20),
    streakDays,
    weeklyAccuracy,
  };
}
