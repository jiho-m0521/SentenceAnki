type MyMemoryResponse = {
  responseData?: {
    translatedText?: string;
  };
  responseStatus?: number;
  responseDetails?: string;
};

export async function translateEnglishToKorean(text: string) {
  const source = text.trim();
  if (!source) throw new Error("번역할 영어 문장을 먼저 입력하세요.");

  const params = new URLSearchParams({
    q: source,
    langpair: "en|ko",
  });
  const response = await fetch(`https://api.mymemory.translated.net/get?${params.toString()}`);
  if (!response.ok) throw new Error("자동 번역 요청에 실패했습니다.");

  const data = (await response.json()) as MyMemoryResponse;
  const translated = data.responseData?.translatedText?.trim();
  if (!translated) {
    throw new Error(data.responseDetails || "번역 결과를 받지 못했습니다.");
  }

  return translated;
}
