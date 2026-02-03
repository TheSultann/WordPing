const DEFAULT_API = 'https://api.mymemory.translated.net/get';

type MyMemoryResponse = {
  responseData?: { translatedText?: string };
};

/**
 * Fetch translation EN->RU via public API (MyMemory).
 * Returns null on any error to avoid blocking the flow.
 */
export const suggestTranslation = async (wordEn: string): Promise<string | null> => {
  const query = wordEn.trim();
  if (!query) return null;

  const apiUrl = process.env.TRANSLATE_API_URL || DEFAULT_API;
  const url = `${apiUrl}?q=${encodeURIComponent(query)}&langpair=en|ru`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as MyMemoryResponse;
    const text = data?.responseData?.translatedText;
    if (text && typeof text === 'string' && text.trim().length > 0) {
      return text.trim();
    }
  } catch (e) {
    return null;
  }

  return null;
};
   