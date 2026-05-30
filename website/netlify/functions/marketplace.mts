import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { createMarketplacePayload } from "../../src/marketplace";
import type { MarketplaceDeckPayload, MarketplaceDeckSummary } from "../../src/types";

const storeName = "sentence-anki-marketplace";
const indexKey = "marketplace/index.json";

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

function readBody(req: Request) {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > 1_000_000) throw new Error("요청 크기는 1MB 이하여야 합니다.");
  return req.json();
}

async function readIndex() {
  const store = getStore({ name: storeName, consistency: "strong" });
  const summaries = (await store.get(indexKey, { type: "json" })) as MarketplaceDeckSummary[] | null;
  return Array.isArray(summaries) ? summaries : [];
}

async function writeIndex(summaries: MarketplaceDeckSummary[]) {
  const store = getStore({ name: storeName, consistency: "strong" });
  await store.setJSON(indexKey, summaries);
}

async function getDeck(id: string) {
  const store = getStore({ name: storeName, consistency: "strong" });
  return (await store.get(`marketplace/decks/${id}.json`, { type: "json" })) as MarketplaceDeckPayload | null;
}

async function listDecks() {
  const summaries = await readIndex();
  return json({
    decks: summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  });
}

async function createDeck(req: Request) {
  const body = await readBody(req);
  const { payload, issues } = createMarketplacePayload(body);
  if (issues.length > 0) return json({ message: "업로드할 수 없는 덱입니다.", issues }, { status: 400 });

  const store = getStore({ name: storeName, consistency: "strong" });
  const summaries = await readIndex();
  const uniqueTitle = payload.summary.title.toLocaleLowerCase();
  const duplicate = summaries.some((summary) => summary.title.toLocaleLowerCase() === uniqueTitle && summary.authorName === payload.summary.authorName);
  if (duplicate) return json({ message: "같은 제작자의 동일한 이름 덱이 이미 있습니다.", issues: ["덱 이름을 다르게 지정하세요."] }, { status: 409 });

  await store.setJSON(`marketplace/decks/${payload.summary.id}.json`, payload, {
    metadata: {
      title: payload.summary.title,
      sentenceCount: String(payload.summary.sentenceCount),
      createdAt: payload.summary.createdAt,
    },
  });
  await writeIndex([payload.summary, ...summaries].slice(0, 500));
  return json(payload, { status: 201 });
}

async function reportDeck(req: Request) {
  const body = (await readBody(req)) as { deckId?: unknown; reason?: unknown; detail?: unknown };
  const deckId = String(body.deckId ?? "").trim();
  const reason = String(body.reason ?? "").trim().slice(0, 80);
  const detail = String(body.detail ?? "").trim().slice(0, 600);
  if (!deckId || !reason) return json({ message: "신고할 덱과 사유가 필요합니다." }, { status: 400 });
  const store = getStore({ name: storeName, consistency: "strong" });
  const reportId = crypto.randomUUID();
  await store.setJSON(`marketplace/reports/${reportId}.json`, {
    id: reportId,
    deckId,
    reason,
    detail,
    createdAt: new Date().toISOString(),
  });
  return json({ ok: true });
}

export default async (req: Request, context: Context) => {
  try {
    const id = context.params.id;
    const pathname = new URL(req.url).pathname;
    if (pathname.endsWith("/reports")) {
      if (req.method !== "POST") return json({ message: "Method not allowed" }, { status: 405 });
      return reportDeck(req);
    }
    if (req.method === "GET" && id) {
      const deck = await getDeck(id);
      return deck ? json(deck) : json({ message: "덱을 찾지 못했습니다." }, { status: 404 });
    }
    if (req.method === "GET") return listDecks();
    if (req.method === "POST") return createDeck(req);
    return json({ message: "Method not allowed" }, { status: 405 });
  } catch (error) {
    return json({ message: error instanceof Error ? error.message : "요청 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
};

export const config: Config = {
  path: ["/api/marketplace/decks", "/api/marketplace/decks/:id", "/api/marketplace/reports"],
};
