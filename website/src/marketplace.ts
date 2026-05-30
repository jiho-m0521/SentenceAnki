import type { DeckIcon, MarketplaceDeckPayload, MarketplaceDeckSummary, MarketplaceSentence } from "./types";
import { createId } from "./utils";

export const marketplaceLimits = {
  maxSentences: 500,
  maxPayloadBytes: 1_000_000,
  maxTitleLength: 80,
  maxDescriptionLength: 600,
  maxAuthorLength: 40,
  maxTagLength: 24,
  maxSentenceLength: 500,
};

export const deckColors = ["#2563eb", "#0f766e", "#7c3aed", "#c2410c", "#be123c", "#334155"];
export const deckIcons: DeckIcon[] = ["book", "message", "graduation", "star", "coffee", "globe"];

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanTags(tags: unknown) {
  if (!Array.isArray(tags)) return [];
  return tags.map((tag) => cleanText(tag, marketplaceLimits.maxTagLength)).filter(Boolean).slice(0, 8);
}

function safeColor(value: unknown) {
  const text = String(value ?? "");
  return /^#[0-9a-f]{6}$/i.test(text) ? text : deckColors[0];
}

function safeIcon(value: unknown): DeckIcon {
  return deckIcons.includes(value as DeckIcon) ? (value as DeckIcon) : "book";
}

export function estimatePayloadBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function normalizeMarketplacePayload(input: unknown): MarketplaceDeckPayload {
  const data = input as Partial<MarketplaceDeckPayload> & {
    title?: unknown;
    description?: unknown;
    authorName?: unknown;
    tags?: unknown;
    color?: unknown;
    icon?: unknown;
    sentences?: unknown;
  };
  const summaryInput = (data.summary ?? data) as Partial<MarketplaceDeckSummary> & {
    title?: unknown;
    description?: unknown;
    authorName?: unknown;
    tags?: unknown;
    color?: unknown;
    icon?: unknown;
    id?: unknown;
    downloads?: unknown;
    createdAt?: unknown;
  };
  const title = cleanText(summaryInput.title, marketplaceLimits.maxTitleLength);
  const description = cleanText(summaryInput.description, marketplaceLimits.maxDescriptionLength);
  const authorName = cleanText(summaryInput.authorName, marketplaceLimits.maxAuthorLength);
  const sentences = Array.isArray(data.sentences)
    ? data.sentences.map((sentence) => {
        const row = sentence as Partial<MarketplaceSentence>;
        return {
          english: cleanText(row.english, marketplaceLimits.maxSentenceLength),
          korean: cleanText(row.korean, marketplaceLimits.maxSentenceLength),
          tags: cleanTags(row.tags),
        };
      })
    : [];
  const validSentences = sentences.filter((sentence) => sentence.english && sentence.korean);
  const now = new Date().toISOString();
  const id = cleanText(summaryInput.id, 80) || createId("market");
  const summary: MarketplaceDeckSummary = {
    id,
    title,
    description,
    authorName,
    tags: cleanTags(summaryInput.tags),
    sentenceCount: validSentences.length,
    downloads: Number(summaryInput.downloads ?? 0) || 0,
    createdAt: cleanText(summaryInput.createdAt, 40) || now,
    updatedAt: now,
    color: safeColor(summaryInput.color),
    icon: safeIcon(summaryInput.icon),
  };
  return { summary, sentences: validSentences };
}

export function validateMarketplacePayload(payload: MarketplaceDeckPayload) {
  const issues: string[] = [];
  if (!payload.summary.title) issues.push("덱 이름이 필요합니다.");
  if (!payload.summary.description) issues.push("덱 설명이 필요합니다.");
  if (!payload.summary.authorName) issues.push("제작자 표시명이 필요합니다.");
  if (payload.sentences.length === 0) issues.push("문장이 1개 이상 필요합니다.");
  if (payload.sentences.length > marketplaceLimits.maxSentences) issues.push(`문장은 최대 ${marketplaceLimits.maxSentences}개까지 업로드할 수 있습니다.`);
  if (payload.sentences.some((sentence) => !sentence.english || !sentence.korean)) issues.push("영어/한국어가 비어 있는 문장이 있습니다.");
  if (estimatePayloadBytes(payload) > marketplaceLimits.maxPayloadBytes) issues.push("덱 파일 크기는 1MB 이하여야 합니다.");
  return issues;
}

export function createMarketplacePayload(input: unknown) {
  const payload = normalizeMarketplacePayload(input);
  const issues = validateMarketplacePayload(payload);
  return { payload, issues };
}
