const HF_DEFAULT_BASE_URL = 'https://router.huggingface.co/hf-inference/models';
const HF_DEFAULT_MODEL_RU_EN = 'Helsinki-NLP/opus-mt-ru-en';
const HF_DEFAULT_MODEL_EN_RU = 'Helsinki-NLP/opus-mt-en-ru';
const HF_DEFAULT_MODEL_UZ_EN = 'Helsinki-NLP/opus-mt-uz-en';
const HF_DEFAULT_MODEL_EN_UZ = 'Helsinki-NLP/opus-mt-en-uz';

const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash-lite';
const GEMINI_DEFAULT_FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash-lite'];
const MYMEMORY_DEFAULT_URL = 'https://api.mymemory.translated.net/get';

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_CACHE_MAX = 2000;

type Lang = 'ru' | 'en' | 'uz';

type HfTranslationItem = {
  translation_text?: string;
};

type HfResponse = {
  error?: string;
  estimated_time?: number;
} | HfTranslationItem[] | HfTranslationItem;

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

type MyMemoryResponse = {
  responseData?: {
    translatedText?: string;
  };
};

const translationCache = new Map<string, string>();
const inFlightRequests = new Map<string, Promise<string | null>>();

const trimEnv = (value: string | undefined): string => (value ?? '').trim();

const normalizeText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
};

const wait = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const readTimeoutMs = (): number => {
  const raw = Number.parseInt(trimEnv(process.env.TRANSLATE_API_TIMEOUT_MS), 10);
  if (!Number.isFinite(raw) || raw < 1000 || raw > 30000) return DEFAULT_TIMEOUT_MS;
  return raw;
};

const readCacheMax = (): number => {
  const raw = Number.parseInt(trimEnv(process.env.TRANSLATE_CACHE_MAX), 10);
  if (!Number.isFinite(raw) || raw < 100 || raw > 20000) return DEFAULT_CACHE_MAX;
  return raw;
};

const readGeminiModels = (): string[] => {
  const primary = trimEnv(process.env.GEMINI_MODEL) || GEMINI_DEFAULT_MODEL;
  const fallbackRaw = trimEnv(process.env.GEMINI_FALLBACK_MODELS);
  const fallback = fallbackRaw
    ? fallbackRaw.split(',').map((item) => item.trim()).filter(Boolean)
    : GEMINI_DEFAULT_FALLBACK_MODELS;

  return Array.from(new Set([primary, ...fallback]));
};

export const detectLanguage = (text: string): Lang => {
  const value = text.trim().toLowerCase();
  if (!value) return 'en';

  // Cyrillic text is treated as Russian.
  if (/[\u0400-\u04FF]/u.test(value)) return 'ru';

  // Uzbek-specific latin markers: apostrophe-based letters (o', g').
  if (/[\u02BB\u02BC]/u.test(value)) return 'uz';
  if (/(o['\u02BB\u02BC\u2019`]|g['\u02BB\u02BC\u2019`])/iu.test(value)) return 'uz';

  // Known Uzbek words (reliable, not found in English).
  const uzWords = [
    'salom', 'rahmat', 'yaxshi', 'bugun', 'qanday', 'iltimos', 'dunyo',
    'tushun', 'bilaman', 'kerak', 'bormi', 'nima', 'qayerda', 'xayr',
  ];
  if (uzWords.some((word) => value.includes(word))) return 'uz';

  return 'en';
};

const getCacheKey = (text: string, source: Lang, target: Lang): string => {
  return `${source}|${target}|${text.trim().toLowerCase()}`;
};

const readCachedTranslation = (key: string): string | null => {
  return translationCache.get(key) ?? null;
};

const writeCachedTranslation = (key: string, value: string): void => {
  if (translationCache.has(key)) {
    translationCache.delete(key);
  }
  translationCache.set(key, value);

  const cacheMax = readCacheMax();
  while (translationCache.size > cacheMax) {
    const oldest = translationCache.keys().next().value as string | undefined;
    if (!oldest) break;
    translationCache.delete(oldest);
  }
};

const fetchJson = async <T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; data: T | null }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const raw = await res.text();
    let data: T | null = null;

    if (raw) {
      try {
        data = JSON.parse(raw) as T;
      } catch {
        data = null;
      }
    }

    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timeout);
  }
};

const hfModelFor = (source: Lang, target: Lang): string | null => {
  if (source === 'ru' && target === 'en') return trimEnv(process.env.HF_MODEL_RU_EN) || HF_DEFAULT_MODEL_RU_EN;
  if (source === 'en' && target === 'ru') return trimEnv(process.env.HF_MODEL_EN_RU) || HF_DEFAULT_MODEL_EN_RU;
  if (source === 'uz' && target === 'en') return trimEnv(process.env.HF_MODEL_UZ_EN) || HF_DEFAULT_MODEL_UZ_EN;
  if (source === 'en' && target === 'uz') return trimEnv(process.env.HF_MODEL_EN_UZ) || HF_DEFAULT_MODEL_EN_UZ;
  return null;
};

const parseHfTranslation = (data: HfResponse | null): string | null => {
  if (!data) return null;

  if (Array.isArray(data)) {
    return normalizeText(data[0]?.translation_text);
  }

  if ('translation_text' in data) {
    return normalizeText(data.translation_text);
  }

  return null;
};

const translateWithHfStep = async (text: string, source: Lang, target: Lang, timeoutMs: number): Promise<string | null> => {
  const token = trimEnv(process.env.HF_API_KEY);
  if (!token) return null;

  const model = hfModelFor(source, target);
  if (!model) return null;

  const base = trimEnv(process.env.HF_INFERENCE_BASE_URL) || HF_DEFAULT_BASE_URL;
  const url = `${base}/${model}`;
  const body = JSON.stringify({ inputs: text });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await fetchJson<HfResponse>(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body,
      },
      timeoutMs,
    );

    if (res.ok) {
      const translated = parseHfTranslation(res.data);
      if (translated) return translated;
      return null;
    }

    const maybeError = res.data && !Array.isArray(res.data) && 'error' in res.data ? res.data : null;
    const estimated = maybeError?.estimated_time;
    if (attempt === 0 && res.status === 503 && typeof estimated === 'number' && Number.isFinite(estimated)) {
      await wait(Math.min(3000, Math.max(500, Math.floor(estimated * 1000))));
      continue;
    }

    return null;
  }

  return null;
};

const languageName = (lang: Lang): string => {
  if (lang === 'ru') return 'Russian';
  if (lang === 'uz') return 'Uzbek';
  return 'English';
};

const parseGeminiTranslation = (data: GeminiResponse | null): string | null => {
  if (!data?.candidates?.length) return null;
  const parts = data.candidates[0]?.content?.parts ?? [];
  const merged = parts.map((part) => part.text ?? '').join(' ').trim();
  return normalizeText(merged);
};

const translateWithGeminiStep = async (text: string, source: Lang, target: Lang, timeoutMs: number): Promise<string | null> => {
  const key = trimEnv(process.env.GEMINI_API_KEY);
  if (!key) return null;

  const base = trimEnv(process.env.GEMINI_API_BASE_URL) || GEMINI_DEFAULT_BASE_URL;
  const models = readGeminiModels();

  const prompt = [
    `Translate text from ${languageName(source)} to ${languageName(target)}.`,
    'Return only translated text without comments.',
    `Text: ${text}`,
  ].join('\n');

  for (const model of models) {
    const res = await fetchJson<GeminiResponse>(
      `${base}/${model}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, topP: 1, topK: 1 },
        }),
      },
      timeoutMs,
    );

    if (!res.ok) continue;

    const translated = parseGeminiTranslation(res.data);
    if (translated) return translated;
  }

  return null;
};

const translateWithMyMemoryStep = async (text: string, source: Lang, target: Lang, timeoutMs: number): Promise<string | null> => {
  const base = trimEnv(process.env.TRANSLATE_API_URL) || MYMEMORY_DEFAULT_URL;
  const url = `${base}?q=${encodeURIComponent(text)}&langpair=${source}|${target}`;

  const res = await fetchJson<MyMemoryResponse>(url, { method: 'GET' }, timeoutMs);
  if (!res.ok) return null;

  return normalizeText(res.data?.responseData?.translatedText);
};

const translateOneStep = async (text: string, source: Lang, target: Lang, timeoutMs: number): Promise<string | null> => {
  if (source === target) return text;

  const hf = await translateWithHfStep(text, source, target, timeoutMs);
  if (hf) return hf;

  const gemini = await translateWithGeminiStep(text, source, target, timeoutMs);
  if (gemini) return gemini;

  return translateWithMyMemoryStep(text, source, target, timeoutMs);
};

const translateWithRouting = async (text: string, source: Lang, target: Lang, timeoutMs: number): Promise<string | null> => {
  if (source === target) return null;

  if (source === 'ru' && target === 'uz') {
    const viaEn = await translateOneStep(text, 'ru', 'en', timeoutMs);
    if (!viaEn) return null;
    return translateOneStep(viaEn, 'en', 'uz', timeoutMs);
  }

  if (source === 'uz' && target === 'ru') {
    const viaEn = await translateOneStep(text, 'uz', 'en', timeoutMs);
    if (!viaEn) return null;
    return translateOneStep(viaEn, 'en', 'ru', timeoutMs);
  }

  return translateOneStep(text, source, target, timeoutMs);
};

export const translateAuto = async (input: string, target: Lang = 'ru'): Promise<string | null> => {
  const text = input.trim();
  if (!text) return null;

  const source = detectLanguage(text);
  const cacheKey = getCacheKey(text, source, target);
  const cached = readCachedTranslation(cacheKey);
  if (cached) return cached;

  const inFlight = inFlightRequests.get(cacheKey);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const translated = await translateWithRouting(text, source, target, readTimeoutMs());
    if (translated) writeCachedTranslation(cacheKey, translated);
    return translated;
  })();

  inFlightRequests.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
};

/**
 * Auto-translate user input.
 * Used by bot add-flow to prefill suggested translation.
 * @param word - the word/phrase to translate
 * @param targetLang - target language ('ru' by default, 'uz' for Uzbek users)
 */
export const suggestTranslation = async (word: string, targetLang: 'ru' | 'uz' = 'ru'): Promise<string | null> => {
  const target: Lang = targetLang === 'uz' ? 'uz' : 'ru';
  return translateAuto(word, target);
};
