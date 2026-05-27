import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import * as XLSX from "xlsx";
import type { BackupPayload, ImportPreview, ImportSentence, Sentence } from "./types";
import { createId, normalizeFilename } from "./utils";

function normalizeHeader(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function requireColumns(headers: string[]) {
  const normalized = headers.map(normalizeHeader);
  const englishIndex = normalized.findIndex((header) => header === "english" || header === "eng");
  const koreanIndex = normalized.findIndex((header) => header === "korean" || header === "kor");
  if (englishIndex === -1 || koreanIndex === -1) throw new Error("파일에는 English/Korean 컬럼이 필요합니다.");
  return { englishIndex, koreanIndex };
}

function buildPreview(fileName: string, rows: ImportSentence[], existingSentences: Sentence[] = []): ImportPreview {
  const existing = new Set(existingSentences.map((sentence) => sentence.english.trim().toLocaleLowerCase()));
  const seen = new Set<string>();
  const normalizedRows = rows.map((row, index) => {
    const issues: string[] = [];
    const englishKey = row.english.trim().toLocaleLowerCase();
    if (!row.english.trim()) issues.push("English가 비어 있습니다.");
    if (!row.korean.trim()) issues.push("Korean이 비어 있습니다.");
    if (englishKey && (existing.has(englishKey) || seen.has(englishKey))) issues.push("중복 문장입니다.");
    if (englishKey) seen.add(englishKey);
    return { ...row, rowNumber: row.rowNumber ?? index + 2, issues, valid: issues.length === 0 };
  });
  return {
    id: createId("preview"),
    fileName,
    deckName: normalizeFilename(fileName),
    rows: normalizedRows,
    validRows: normalizedRows.filter((row) => row.valid),
    invalidRows: normalizedRows.filter((row) => !row.valid && !row.issues?.includes("중복 문장입니다.")),
    duplicateRows: normalizedRows.filter((row) => row.issues?.includes("중복 문장입니다.")),
  };
}

export async function previewSpreadsheet(file: File, existingSentences: Sentence[] = []): Promise<ImportPreview> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) throw new Error("읽을 수 있는 시트가 없습니다.");
  const table = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, defval: "" });
  const [headers, ...rows] = table;
  if (!headers || headers.length === 0) throw new Error("파일의 첫 줄에 컬럼명이 필요합니다.");
  const { englishIndex, koreanIndex } = requireColumns(headers.map(String));
  const idIndex = headers.map(normalizeHeader).findIndex((header) => header === "id");
  return buildPreview(
    file.name,
    rows.map((row, index) => ({
      sourceId: idIndex >= 0 ? String(row[idIndex] ?? "") : undefined,
      english: String(row[englishIndex] ?? "").trim(),
      korean: String(row[koreanIndex] ?? "").trim(),
      rowNumber: index + 2,
    })),
    existingSentences,
  );
}

export async function previewSqliteDb(file: File, existingSentences: Sentence[] = []): Promise<ImportPreview> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const db = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
  try {
    const result = db.exec("SELECT id, eng, kor FROM sentences ORDER BY id ASC");
    if (!result[0]) throw new Error("sentences 테이블에서 문장을 찾지 못했습니다.");
    return buildPreview(
      file.name,
      result[0].values.map((row, index) => ({
        sourceId: row[0] as number | string,
        english: String(row[1] ?? "").trim(),
        korean: String(row[2] ?? "").trim(),
        rowNumber: index + 1,
      })),
      existingSentences,
    );
  } finally {
    db.close();
  }
}

export async function previewImportFile(file: File, existingSentences: Sentence[] = []) {
  const lower = file.name.toLocaleLowerCase();
  return lower.endsWith(".db") ? previewSqliteDb(file, existingSentences) : previewSpreadsheet(file, existingSentences);
}

export async function parseSpreadsheet(file: File) {
  const preview = await previewSpreadsheet(file);
  return { deckName: preview.deckName, rows: preview.validRows };
}

export async function parseSqliteDb(file: File) {
  const preview = await previewSqliteDb(file);
  return { deckName: preview.deckName, rows: preview.validRows };
}

export async function parseBackup(file: File): Promise<BackupPayload> {
  const text = await file.text();
  return JSON.parse(text) as BackupPayload;
}
