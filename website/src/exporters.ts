import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import * as XLSX from "xlsx";
import type { Deck, ReviewState, Sentence, StudyRecord } from "./types";
import { downloadBlob, downloadJson } from "./utils";

export type ExportFormat = "json" | "xlsx" | "csv" | "db";

function rowsForExport(sentences: Sentence[]) {
  return sentences.map((sentence, index) => ({
    ID: index + 1,
    English: sentence.english,
    Korean: sentence.korean,
  }));
}

function exportBaseName(deck: Deck) {
  return `${deck.name}-sentence-anki`;
}

export async function exportDeckFile(
  deck: Deck,
  sentences: Sentence[],
  format: ExportFormat,
  options: { includeHistory?: boolean; studyRecords?: StudyRecord[]; reviewStates?: ReviewState[] } = {},
) {
  const baseName = exportBaseName(deck);

  if (format === "json") {
    downloadJson(`${baseName}.json`, {
      version: 2,
      exportedAt: new Date().toISOString(),
      decks: [deck],
      sentences,
      studyRecords: options.includeHistory ? (options.studyRecords ?? []) : [],
      reviewStates: options.includeHistory ? (options.reviewStates ?? []) : [],
    });
    return;
  }

  if (format === "xlsx") {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rowsForExport(sentences), {
      header: ["ID", "English", "Korean"],
    });
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sentences");
    const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    downloadBlob(`${baseName}.xlsx`, new Blob([output], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    return;
  }

  if (format === "csv") {
    const worksheet = XLSX.utils.json_to_sheet(rowsForExport(sentences), {
      header: ["ID", "English", "Korean"],
    });
    const csv = XLSX.utils.sheet_to_csv(worksheet);
    downloadBlob(`${baseName}.csv`, new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    return;
  }

  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const db = new SQL.Database();
  try {
    db.run("CREATE TABLE sentences (id INTEGER PRIMARY KEY AUTOINCREMENT, eng TEXT, kor TEXT)");
    for (const sentence of sentences) {
      db.run("INSERT INTO sentences (eng, kor) VALUES (?, ?)", [sentence.english, sentence.korean]);
    }
    const output = db.export();
    const bytes = new Uint8Array(output);
    downloadBlob(`${baseName}.db`, new Blob([bytes.buffer], { type: "application/x-sqlite3" }));
  } finally {
    db.close();
  }
}
