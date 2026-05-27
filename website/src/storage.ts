import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { AppSettings, BackupPayload, Deck, ReviewState, Sentence, StudyRecord, SyncQueueItem } from "./types";
import { defaultSettings, updateReviewState } from "./study";
import { createId, nowIso } from "./utils";

interface SentenceAnkiDb extends DBSchema {
  decks: {
    key: string;
    value: Deck;
    indexes: { "by-updated": string };
  };
  sentences: {
    key: string;
    value: Sentence;
    indexes: { "by-deck": string; "by-updated": string };
  };
  studyRecords: {
    key: string;
    value: StudyRecord;
    indexes: { "by-deck": string; "by-sentence": string; "by-studied": string };
  };
  reviewStates: {
    key: string;
    value: ReviewState;
    indexes: { "by-deck": string; "by-next-review": string };
  };
  settings: {
    key: string;
    value: AppSettings;
  };
  syncQueue: {
    key: string;
    value: SyncQueueItem;
    indexes: { "by-updated": string };
  };
}

let dbPromise: Promise<IDBPDatabase<SentenceAnkiDb>> | undefined;

function getDb() {
  dbPromise ??= openDB<SentenceAnkiDb>("sentence-anki-web", 2, {
    upgrade(db, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) {
        const deckStore = db.createObjectStore("decks", { keyPath: "id" });
        deckStore.createIndex("by-updated", "updatedAt");
        const sentenceStore = db.createObjectStore("sentences", { keyPath: "id" });
        sentenceStore.createIndex("by-deck", "deckId");
      }
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains("studyRecords")) {
          const records = db.createObjectStore("studyRecords", { keyPath: "id" });
          records.createIndex("by-deck", "deckId");
          records.createIndex("by-sentence", "sentenceId");
          records.createIndex("by-studied", "studiedAt");
        }
        if (!db.objectStoreNames.contains("reviewStates")) {
          const reviews = db.createObjectStore("reviewStates", { keyPath: "id" });
          reviews.createIndex("by-deck", "deckId");
          reviews.createIndex("by-next-review", "nextReviewAt");
        }
        if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "id" });
        if (!db.objectStoreNames.contains("syncQueue")) {
          const sync = db.createObjectStore("syncQueue", { keyPath: "id" });
          sync.createIndex("by-updated", "updatedAt");
        }
        const sentenceStore = transaction.objectStore("sentences");
        if (!sentenceStore.indexNames.contains("by-updated")) sentenceStore.createIndex("by-updated", "updatedAt");
      }
    },
  });
  return dbPromise;
}

function normalizeDeck(deck: Deck): Deck {
  return {
    ...deck,
    tags: deck.tags ?? [],
    archived: deck.archived ?? false,
    deleted: deck.deleted ?? false,
    orderIndex: deck.orderIndex ?? 0,
  };
}

function normalizeSentence(sentence: Sentence): Sentence {
  return {
    ...sentence,
    tags: sentence.tags ?? [],
    archived: sentence.archived ?? false,
    deleted: sentence.deleted ?? false,
    orderIndex: sentence.orderIndex ?? 0,
  };
}

async function enqueue(entity: SyncQueueItem["entity"], entityId: string, operation: SyncQueueItem["operation"]) {
  const db = await getDb();
  const timestamp = nowIso();
  await db.put("syncQueue", {
    id: createId("sync"),
    entity,
    entityId,
    operation,
    updatedAt: timestamp,
  });
}

export async function listDecks(includeArchived = false) {
  const db = await getDb();
  const decks = (await db.getAll("decks")).map(normalizeDeck);
  return decks
    .filter((deck) => !deck.deleted && (includeArchived || !deck.archived))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getDeck(id: string) {
  const db = await getDb();
  const deck = await db.get("decks", id);
  return deck ? normalizeDeck(deck) : undefined;
}

export async function createDeck(name: string) {
  const db = await getDb();
  const timestamp = nowIso();
  const deck: Deck = {
    id: createId("deck"),
    name: name.trim() || "새 문장 세트",
    tags: [],
    archived: false,
    orderIndex: Date.now(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db.add("decks", deck);
  await enqueue("deck", deck.id, "upsert");
  return deck;
}

export async function updateDeck(deck: Deck) {
  const db = await getDb();
  const updated = normalizeDeck({ ...deck, updatedAt: nowIso() });
  await db.put("decks", updated);
  await enqueue("deck", updated.id, updated.deleted ? "delete" : "upsert");
  return updated;
}

export async function touchDeck(deckId: string) {
  const deck = await getDeck(deckId);
  if (!deck) return;
  await updateDeck({ ...deck, lastStudiedAt: nowIso() });
}

export async function deleteDeck(deckId: string) {
  const db = await getDb();
  const timestamp = nowIso();
  const tx = db.transaction(["decks", "sentences"], "readwrite");
  const deck = await tx.objectStore("decks").get(deckId);
  if (deck) await tx.objectStore("decks").put(normalizeDeck({ ...deck, deleted: true, updatedAt: timestamp }));
  const sentences = await tx.objectStore("sentences").index("by-deck").getAll(deckId);
  await Promise.all(sentences.map((sentence) => tx.objectStore("sentences").put(normalizeSentence({ ...sentence, deleted: true, updatedAt: timestamp }))));
  await tx.done;
  await enqueue("deck", deckId, "delete");
}

export async function listSentences(deckId: string, includeArchived = false) {
  const db = await getDb();
  const sentences = (await db.getAllFromIndex("sentences", "by-deck", deckId)).map(normalizeSentence);
  return sentences
    .filter((sentence) => !sentence.deleted && (includeArchived || !sentence.archived))
    .sort((a, b) => a.orderIndex - b.orderIndex || a.createdAt.localeCompare(b.createdAt));
}

export async function listAllSentences() {
  const db = await getDb();
  return (await db.getAll("sentences")).map(normalizeSentence).filter((sentence) => !sentence.deleted);
}

export async function upsertSentence(
  sentence: Omit<Sentence, "id" | "createdAt" | "updatedAt" | "tags" | "archived" | "orderIndex"> &
    Partial<Pick<Sentence, "id" | "createdAt" | "tags" | "archived" | "source" | "orderIndex">>,
) {
  const db = await getDb();
  const timestamp = nowIso();
  const value: Sentence = {
    id: sentence.id ?? createId("sentence"),
    deckId: sentence.deckId,
    english: sentence.english.trim(),
    korean: sentence.korean.trim(),
    selected: sentence.selected,
    tags: sentence.tags ?? [],
    source: sentence.source,
    archived: sentence.archived ?? false,
    orderIndex: sentence.orderIndex ?? Date.now(),
    createdAt: sentence.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  await db.put("sentences", value);
  const deck = await getDeck(value.deckId);
  if (deck) await updateDeck(deck);
  await enqueue("sentence", value.id, "upsert");
  return value;
}

export async function setSentenceSelected(id: string, selected: boolean) {
  const db = await getDb();
  const sentence = await db.get("sentences", id);
  if (!sentence) return;
  await db.put("sentences", normalizeSentence({ ...sentence, selected, updatedAt: nowIso() }));
}

export async function deleteSentences(ids: string[]) {
  const db = await getDb();
  const tx = db.transaction("sentences", "readwrite");
  const timestamp = nowIso();
  await Promise.all(
    ids.map(async (id) => {
      const sentence = await tx.store.get(id);
      if (sentence) await tx.store.put(normalizeSentence({ ...sentence, deleted: true, updatedAt: timestamp }));
    }),
  );
  await tx.done;
  await Promise.all(ids.map((id) => enqueue("sentence", id, "delete")));
}

export async function clearDeckSentences(deckId: string) {
  const sentences = await listSentences(deckId);
  await deleteSentences(sentences.map((sentence) => sentence.id));
}

export async function addImportedSentences(deckId: string, rows: Array<{ english: string; korean: string; sourceId?: string | number }>) {
  const db = await getDb();
  const timestamp = nowIso();
  const tx = db.transaction(["sentences", "decks"], "readwrite");
  const values = rows
    .map((row, index) => ({ english: row.english.trim(), korean: row.korean.trim(), sourceId: row.sourceId, orderIndex: Date.now() + index }))
    .filter((row) => row.english && row.korean)
    .map<Sentence>((row) => ({
      id: createId("sentence"),
      deckId,
      english: row.english,
      korean: row.korean,
      selected: false,
      tags: [],
      source: row.sourceId ? String(row.sourceId) : undefined,
      archived: false,
      orderIndex: row.orderIndex,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
  await Promise.all(values.map((sentence) => tx.objectStore("sentences").add(sentence)));
  const deck = await tx.objectStore("decks").get(deckId);
  if (deck) await tx.objectStore("decks").put(normalizeDeck({ ...deck, updatedAt: timestamp }));
  await tx.done;
  await Promise.all(values.map((sentence) => enqueue("sentence", sentence.id, "upsert")));
  return values.length;
}

export async function getSettings() {
  const db = await getDb();
  const settings = await db.get("settings", "default");
  if (settings) return settings;
  await db.put("settings", defaultSettings);
  return defaultSettings;
}

export async function updateSettings(next: AppSettings) {
  const db = await getDb();
  const settings = { ...next, updatedAt: nowIso() };
  await db.put("settings", settings);
  await enqueue("settings", "default", "upsert");
  return settings;
}

export async function listStudyRecords(deckId?: string) {
  const db = await getDb();
  const records = deckId ? await db.getAllFromIndex("studyRecords", "by-deck", deckId) : await db.getAll("studyRecords");
  return records.sort((a, b) => b.studiedAt.localeCompare(a.studiedAt));
}

export async function listReviewStates(deckId?: string) {
  const db = await getDb();
  const states = deckId ? await db.getAllFromIndex("reviewStates", "by-deck", deckId) : await db.getAll("reviewStates");
  return states.sort((a, b) => a.nextReviewAt.localeCompare(b.nextReviewAt));
}

export async function saveStudyRecords(records: StudyRecord[]) {
  const db = await getDb();
  const tx = db.transaction(["studyRecords", "reviewStates"], "readwrite");
  for (const record of records) {
    await tx.objectStore("studyRecords").put(record);
    const current = await tx.objectStore("reviewStates").get(`review_${record.sentenceId}`);
    await tx.objectStore("reviewStates").put(updateReviewState(current, record));
  }
  await tx.done;
  await Promise.all(records.map((record) => enqueue("studyRecord", record.id, "upsert")));
}

export async function exportBackup(includeHistory = true): Promise<BackupPayload> {
  const db = await getDb();
  return {
    version: 2,
    exportedAt: nowIso(),
    decks: (await db.getAll("decks")).map(normalizeDeck).filter((deck) => !deck.deleted),
    sentences: (await db.getAll("sentences")).map(normalizeSentence).filter((sentence) => !sentence.deleted),
    studyRecords: includeHistory ? await db.getAll("studyRecords") : [],
    reviewStates: includeHistory ? await db.getAll("reviewStates") : [],
    settings: await getSettings(),
  };
}

export async function importBackup(payload: BackupPayload) {
  if (![1, 2].includes(payload.version) || !Array.isArray(payload.decks) || !Array.isArray(payload.sentences)) {
    throw new Error("지원하지 않는 백업 파일입니다.");
  }
  const db = await getDb();
  const tx = db.transaction(["decks", "sentences", "studyRecords", "reviewStates", "settings"], "readwrite");
  await Promise.all(payload.decks.map((deck) => tx.objectStore("decks").put(normalizeDeck(deck))));
  await Promise.all(payload.sentences.map((sentence) => tx.objectStore("sentences").put(normalizeSentence(sentence))));
  await Promise.all((payload.studyRecords ?? []).map((record) => tx.objectStore("studyRecords").put(record)));
  await Promise.all((payload.reviewStates ?? []).map((state) => tx.objectStore("reviewStates").put(state)));
  if (payload.settings) await tx.objectStore("settings").put(payload.settings);
  await tx.done;
}

export async function getPendingSyncItems() {
  const db = await getDb();
  return db.getAll("syncQueue");
}

export async function clearSyncItems(ids: string[]) {
  const db = await getDb();
  const tx = db.transaction("syncQueue", "readwrite");
  await Promise.all(ids.map((id) => tx.store.delete(id)));
  await tx.done;
}
