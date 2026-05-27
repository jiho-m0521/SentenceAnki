import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { BackupPayload, Deck, Sentence } from "./types";
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
    indexes: { "by-deck": string };
  };
}

let dbPromise: Promise<IDBPDatabase<SentenceAnkiDb>> | undefined;

function getDb() {
  dbPromise ??= openDB<SentenceAnkiDb>("sentence-anki-web", 1, {
    upgrade(db) {
      const deckStore = db.createObjectStore("decks", { keyPath: "id" });
      deckStore.createIndex("by-updated", "updatedAt");

      const sentenceStore = db.createObjectStore("sentences", { keyPath: "id" });
      sentenceStore.createIndex("by-deck", "deckId");
    },
  });
  return dbPromise;
}

export async function listDecks() {
  const db = await getDb();
  const decks = await db.getAll("decks");
  return decks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getDeck(id: string) {
  const db = await getDb();
  return db.get("decks", id);
}

export async function createDeck(name: string) {
  const db = await getDb();
  const timestamp = nowIso();
  const deck: Deck = {
    id: createId("deck"),
    name: name.trim() || "새 문장 세트",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db.add("decks", deck);
  return deck;
}

export async function updateDeck(deck: Deck) {
  const db = await getDb();
  const updated = { ...deck, updatedAt: nowIso() };
  await db.put("decks", updated);
  return updated;
}

export async function touchDeck(deckId: string) {
  const deck = await getDeck(deckId);
  if (!deck) return;
  await updateDeck({ ...deck, lastStudiedAt: nowIso() });
}

export async function deleteDeck(deckId: string) {
  const db = await getDb();
  const tx = db.transaction(["decks", "sentences"], "readwrite");
  const sentences = await tx.objectStore("sentences").index("by-deck").getAll(deckId);
  await Promise.all(sentences.map((sentence) => tx.objectStore("sentences").delete(sentence.id)));
  await tx.objectStore("decks").delete(deckId);
  await tx.done;
}

export async function listSentences(deckId: string) {
  const db = await getDb();
  const sentences = await db.getAllFromIndex("sentences", "by-deck", deckId);
  return sentences.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function upsertSentence(
  sentence: Omit<Sentence, "id" | "createdAt" | "updatedAt"> & Partial<Pick<Sentence, "id" | "createdAt">>,
) {
  const db = await getDb();
  const timestamp = nowIso();
  const value: Sentence = {
    id: sentence.id ?? createId("sentence"),
    deckId: sentence.deckId,
    english: sentence.english.trim(),
    korean: sentence.korean.trim(),
    selected: sentence.selected,
    createdAt: sentence.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  await db.put("sentences", value);
  const deck = await getDeck(value.deckId);
  if (deck) await updateDeck(deck);
  return value;
}

export async function setSentenceSelected(id: string, selected: boolean) {
  const db = await getDb();
  const sentence = await db.get("sentences", id);
  if (!sentence) return;
  await db.put("sentences", { ...sentence, selected, updatedAt: nowIso() });
}

export async function deleteSentences(ids: string[]) {
  const db = await getDb();
  const tx = db.transaction("sentences", "readwrite");
  await Promise.all(ids.map((id) => tx.store.delete(id)));
  await tx.done;
}

export async function clearDeckSentences(deckId: string) {
  const sentences = await listSentences(deckId);
  await deleteSentences(sentences.map((sentence) => sentence.id));
}

export async function addImportedSentences(deckId: string, rows: Array<{ english: string; korean: string }>) {
  const db = await getDb();
  const timestamp = nowIso();
  const tx = db.transaction(["sentences", "decks"], "readwrite");
  const values = rows
    .map((row) => ({
      english: row.english.trim(),
      korean: row.korean.trim(),
    }))
    .filter((row) => row.english && row.korean)
    .map<Sentence>((row) => ({
      id: createId("sentence"),
      deckId,
      english: row.english,
      korean: row.korean,
      selected: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
  await Promise.all(values.map((sentence) => tx.objectStore("sentences").add(sentence)));
  const deck = await tx.objectStore("decks").get(deckId);
  if (deck) await tx.objectStore("decks").put({ ...deck, updatedAt: timestamp });
  await tx.done;
  return values.length;
}

export async function exportBackup(): Promise<BackupPayload> {
  const db = await getDb();
  return {
    version: 1,
    exportedAt: nowIso(),
    decks: await db.getAll("decks"),
    sentences: await db.getAll("sentences"),
  };
}

export async function importBackup(payload: BackupPayload) {
  if (payload.version !== 1 || !Array.isArray(payload.decks) || !Array.isArray(payload.sentences)) {
    throw new Error("지원하지 않는 백업 파일입니다.");
  }
  const db = await getDb();
  const tx = db.transaction(["decks", "sentences"], "readwrite");
  await Promise.all(payload.decks.map((deck) => tx.objectStore("decks").put(deck)));
  await Promise.all(payload.sentences.map((sentence) => tx.objectStore("sentences").put(sentence)));
  await tx.done;
}
