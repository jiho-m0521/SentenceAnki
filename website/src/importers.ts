import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import * as XLSX from "xlsx";
import type { BackupPayload, ImportSentence } from "./types";
import { normalizeFilename } from "./utils";

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function requireColumns(headers: string[]) {
  const normalized = headers.map(normalizeHeader);
  const englishIndex = normalized.findIndex((header) => header === "english" || header === "eng");
  const koreanIndex = normalized.findIndex((header) => header === "korean" || header === "kor");

  if (englishIndex === -1 || koreanIndex === -1) {
    throw new Error("파일에는 English/Korean 컬럼이 필요합니다.");
  }

  return { englishIndex, koreanIndex };
}

export async function parseSpreadsheet(file: File): Promise<{ deckName: string; rows: ImportSentence[] }> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) throw new Error("읽을 수 있는 시트가 없습니다.");

  const table = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, defval: "" });
  const [headers, ...rows] = table;
  if (!headers || headers.length === 0) throw new Error("파일의 첫 줄에 컬럼명이 필요합니다.");

  const { englishIndex, koreanIndex } = requireColumns(headers.map(String));
  const idIndex = headers.map(normalizeHeader).findIndex((header) => header === "id");

  return {
    deckName: normalizeFilename(file.name),
    rows: rows
      .map((row) => ({
        sourceId: idIndex >= 0 ? String(row[idIndex] ?? "") : undefined,
        english: String(row[englishIndex] ?? "").trim(),
        korean: String(row[koreanIndex] ?? "").trim(),
      }))
      .filter((row) => row.english && row.korean),
  };
}

export async function parseSqliteDb(file: File): Promise<{ deckName: string; rows: ImportSentence[] }> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const db = new SQL.Database(new Uint8Array(await file.arrayBuffer()));

  try {
    const result = db.exec("SELECT id, eng, kor FROM sentences ORDER BY id ASC");
    if (!result[0]) throw new Error("sentences 테이블에서 문장을 찾지 못했습니다.");

    const rows = result[0].values
      .map((row) => ({
        sourceId: row[0] as number | string,
        english: String(row[1] ?? "").trim(),
        korean: String(row[2] ?? "").trim(),
      }))
      .filter((row) => row.english && row.korean);

    return { deckName: normalizeFilename(file.name), rows };
  } finally {
    db.close();
  }
}

export async function parseBackup(file: File): Promise<BackupPayload> {
  const text = await file.text();
  return JSON.parse(text) as BackupPayload;
}
