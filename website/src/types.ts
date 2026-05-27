export type SyncStatus = "local" | "pending" | "synced" | "conflict";

export type Deck = {
  id: string;
  name: string;
  tags: string[];
  source?: string;
  archived: boolean;
  deleted?: boolean;
  orderIndex: number;
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
  tags: string[];
  source?: string;
  archived: boolean;
  deleted?: boolean;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
};

export type StudyMode = "ordered" | "random" | "srs";
export type BlankMode = "random" | "important" | "weak" | "phrase";

export type GradingOptions = {
  ignoreCase: boolean;
  ignorePunctuation: boolean;
  normalizeWhitespace: boolean;
  allowTypo: boolean;
};

export type StudyScreenOptions = {
  autoAdvanceCorrect: boolean;
  showHintButton: boolean;
  manualNextAfterWrong: boolean;
};

export type AppSettings = {
  id: "default";
  grading: GradingOptions;
  blankMode: BlankMode;
  studyScreen: StudyScreenOptions;
  defaultExportIncludesHistory: boolean;
  automaticBackup: boolean;
  updatedAt: string;
};

export type StudySession = {
  id: string;
  deckId: string;
  sentenceIds: string[];
  difficulty: number;
  mode: StudyMode;
  blankMode: BlankMode;
  startedAt: string;
};

export type StudyPrompt = {
  sentence: Sentence;
  blanks: Array<{
    index: number;
    answer: string;
    hint: string;
  }>;
  parts: Array<
    | { type: "text"; value: string }
    | { type: "blank"; index: number; answer: string; hint: string }
  >;
};

export type AnswerDiffPart = {
  type: "same" | "missing" | "extra" | "changed";
  value: string;
};

export type StudyResult = {
  sentenceId: string;
  answer: string;
  correctAnswer: string;
  isCorrect: boolean;
  forcedCorrect: boolean;
  completedAt: string;
  responseMs: number;
  diff: AnswerDiffPart[];
};

export type StudyRecord = {
  id: string;
  deckId: string;
  sentenceId: string;
  sessionId: string;
  answer: string;
  correctAnswer: string;
  isCorrect: boolean;
  forcedCorrect: boolean;
  difficulty: number;
  blankMode: BlankMode;
  responseMs: number;
  studiedAt: string;
};

export type ReviewState = {
  id: string;
  deckId: string;
  sentenceId: string;
  attempts: number;
  correctAttempts: number;
  streak: number;
  srsLevel: number;
  nextReviewAt: string;
  lastStudiedAt?: string;
  lastWrong: boolean;
  updatedAt: string;
};

export type SyncQueueItem = {
  id: string;
  entity: "deck" | "sentence" | "studyRecord" | "reviewState" | "settings";
  entityId: string;
  operation: "upsert" | "delete";
  updatedAt: string;
};

export type ImportSentence = {
  sourceId?: string | number;
  english: string;
  korean: string;
  rowNumber?: number;
  valid?: boolean;
  issues?: string[];
};

export type ImportPreview = {
  id: string;
  fileName: string;
  deckName: string;
  rows: ImportSentence[];
  validRows: ImportSentence[];
  invalidRows: ImportSentence[];
  duplicateRows: ImportSentence[];
};

export type BackupPayload = {
  version: 2;
  exportedAt: string;
  decks: Deck[];
  sentences: Sentence[];
  studyRecords?: StudyRecord[];
  reviewStates?: ReviewState[];
  settings?: AppSettings;
};

export type DashboardMetrics = {
  dueToday: number;
  overdue: number;
  weak: number;
  recentRecords: StudyRecord[];
};
