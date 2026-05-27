export type Deck = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastStudiedAt?: string;
};

export type Sentence = {
  id: string;
  deckId: string;
  english: string;
  korean: string;
  selected: boolean;
  createdAt: string;
  updatedAt: string;
};

export type StudyMode = "ordered" | "random";

export type StudySession = {
  id: string;
  deckId: string;
  sentenceIds: string[];
  difficulty: number;
  mode: StudyMode;
  startedAt: string;
};

export type StudyPrompt = {
  sentence: Sentence;
  blanks: Array<{
    index: number;
    answer: string;
  }>;
  parts: Array<
    | { type: "text"; value: string }
    | { type: "blank"; index: number; answer: string }
  >;
};

export type StudyResult = {
  sentenceId: string;
  answer: string;
  correctAnswer: string;
  isCorrect: boolean;
  forcedCorrect: boolean;
  completedAt: string;
};

export type ImportSentence = {
  sourceId?: string | number;
  english: string;
  korean: string;
};

export type BackupPayload = {
  version: 1;
  exportedAt: string;
  decks: Deck[];
  sentences: Sentence[];
};
