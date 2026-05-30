import { describe, expect, it } from "vitest";
import { createMarketplacePayload, deckColors, marketplaceLimits } from "./marketplace";

describe("marketplace payload validation", () => {
  it("normalizes a valid upload", () => {
    const { payload, issues } = createMarketplacePayload({
      title: "Lesson 1",
      description: "Basic classroom sentences",
      authorName: "Jiho",
      tags: ["class", "test"],
      color: "#0f766e",
      icon: "star",
      sentences: [{ english: "Hello.", korean: "안녕하세요." }],
    });
    expect(issues).toEqual([]);
    expect(payload.summary.sentenceCount).toBe(1);
    expect(payload.summary.color).toBe("#0f766e");
    expect(payload.summary.icon).toBe("star");
  });

  it("rejects missing required fields", () => {
    const { issues } = createMarketplacePayload({ sentences: [] });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues).toContain("덱 이름이 필요합니다.");
  });

  it("rejects uploads over the sentence limit", () => {
    const { issues } = createMarketplacePayload({
      title: "Too many",
      description: "Too many sentences",
      authorName: "Jiho",
      sentences: Array.from({ length: marketplaceLimits.maxSentences + 1 }, (_, index) => ({
        english: `Sentence ${index}`,
        korean: `문장 ${index}`,
      })),
    });
    expect(issues.some((issue) => issue.includes("최대"))).toBe(true);
  });

  it("falls back unknown deck appearance", () => {
    const { payload } = createMarketplacePayload({
      title: "Safe",
      description: "Safe appearance",
      authorName: "Jiho",
      color: "blue",
      icon: "unknown",
      sentences: [{ english: "Yes.", korean: "네." }],
    });
    expect(payload.summary.color).toBe(deckColors[0]);
    expect(payload.summary.icon).toBe("book");
  });
});
