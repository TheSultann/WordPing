const HF_DEFAULT_BASE_URL = 'https://router.huggingface.co/hf-inference/models';
const HF_DEFAULT_MODEL_RU_EN = 'Helsinki-NLP/opus-mt-ru-en';
const HF_DEFAULT_MODEL_EN_RU = 'Helsinki-NLP/opus-mt-en-ru';
const HF_DEFAULT_MODEL_UZ_EN = 'Helsinki-NLP/opus-mt-uz-en';
const HF_DEFAULT_MODEL_EN_UZ = 'Helsinki-NLP/opus-mt-en-uz';

const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash-lite';
const GEMINI_DEFAULT_FALLBACK_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
  'gemini-1.5-pro',
];
const MYMEMORY_DEFAULT_URL = 'https://api.mymemory.translated.net/get';

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_CACHE_MAX = 2000;
const GEMINI_429_BASE_COOLDOWN_MS = 60_000;
const GEMINI_429_MAX_COOLDOWN_MS = 5 * 60_000;

type Lang = 'ru' | 'en' | 'uz';
type DetectHint = {
  preferredNative?: 'ru' | 'uz';
};

export type DetectLanguageResult = {
  lang: Lang;
  ambiguous: boolean;
};

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

type GeminiDetectTranslatePayload = {
  source_lang?: string;
  target_lang?: string;
  translated_text?: string;
  confidence?: number | string;
};

import { trimEnv } from '../utils/env';

const translationCache = new Map<string, string>();
const inFlightRequests = new Map<string, Promise<string | null>>();

type GeminiModelRuntime = {
  cooldownUntil: number;
  rateLimitedStreak: number;
  lastUsedAt: number;
};

const geminiModelPool = new Map<string, GeminiModelRuntime>();
let geminiRoundRobinCursor = 0;
let geminiGlobalPauseUntil = 0;

const normalizeText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
};

const normalizeLatinToken = (value: string): string =>
  value.toLowerCase().replace(/[^a-z]/g, '');

const isSingleLatinToken = (value: string): boolean => /^[a-z]+$/i.test(value.trim());
const isSingleCyrillicToken = (value: string): boolean => /^[а-яё]+$/iu.test(value.trim());

const transliterateRuToLatin = (value: string): string => {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
    и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
    с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
    ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };

  return value
    .toLowerCase()
    .split('')
    .map((char) => map[char] ?? '')
    .join('');
};

const levenshteinDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  const n = a.length;
  const m = b.length;
  if (n === 0) return m;
  if (m === 0) return n;

  const prev = new Float64Array(m + 1);
  const curr = new Float64Array(m + 1);

  for (let j = 0; j <= m; j += 1) prev[j] = j;

  for (let i = 1; i <= n; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= m; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (curr[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    for (let j = 0; j <= m; j += 1) prev[j] = curr[j] ?? 0;
  }

  return prev[m] ?? 0;
};

const isLikelyUzLoanwordFromEnglish = (sourceEn: string, translatedUz: string): boolean => {
  if (!isSingleLatinToken(sourceEn) || !isSingleLatinToken(translatedUz)) return false;

  const source = normalizeLatinToken(sourceEn);
  const translated = normalizeLatinToken(translatedUz);
  if (source.length < 5 || translated.length < 5) return false;

  const distance = levenshteinDistance(source, translated);
  const maxLen = Math.max(source.length, translated.length);
  return distance <= 2 || distance / maxLen <= 0.3;
};

const isLikelyRuLoanwordFromEnglish = (sourceEn: string, translatedRu: string): boolean => {
  if (!isSingleLatinToken(sourceEn) || !isSingleCyrillicToken(translatedRu)) return false;

  const source = normalizeLatinToken(sourceEn);
  const transliterated = normalizeLatinToken(transliterateRuToLatin(translatedRu));
  if (source.length < 5 || transliterated.length < 5) return false;

  const distance = levenshteinDistance(source, transliterated);
  const maxLen = Math.max(source.length, transliterated.length);
  return distance <= 2 || distance / maxLen <= 0.35;
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
  const fallbackConfigured = Object.prototype.hasOwnProperty.call(process.env, 'GEMINI_FALLBACK_MODELS');
  const fallback = fallbackConfigured
    ? fallbackRaw.split(',').map((item) => item.trim()).filter(Boolean)
    : GEMINI_DEFAULT_FALLBACK_MODELS;

  return Array.from(new Set([primary, ...fallback]));
};

const ensureGeminiRuntime = (model: string): GeminiModelRuntime => {
  const existing = geminiModelPool.get(model);
  if (existing) return existing;

  const created: GeminiModelRuntime = {
    cooldownUntil: 0,
    rateLimitedStreak: 0,
    lastUsedAt: 0,
  };
  geminiModelPool.set(model, created);
  return created;
};

const syncGeminiModelPool = (models: string[]) => {
  const active = new Set(models);
  for (const model of models) ensureGeminiRuntime(model);
  for (const model of [...geminiModelPool.keys()]) {
    if (!active.has(model)) geminiModelPool.delete(model);
  }
  if (models.length === 0) {
    geminiRoundRobinCursor = 0;
    geminiGlobalPauseUntil = 0;
    return;
  }
  geminiRoundRobinCursor %= models.length;
};

const getRoundRobinOrder = (models: string[]): string[] => {
  if (models.length <= 1) return [...models];
  const start = geminiRoundRobinCursor % models.length;
  geminiRoundRobinCursor = (geminiRoundRobinCursor + 1) % models.length;
  return [...models.slice(start), ...models.slice(0, start)];
};

const getEarliestCooldownUntil = (models: string[], nowMs: number): number | null => {
  let earliest = Number.POSITIVE_INFINITY;
  for (const model of models) {
    const runtime = ensureGeminiRuntime(model);
    if (runtime.cooldownUntil > nowMs) {
      earliest = Math.min(earliest, runtime.cooldownUntil);
    }
  }
  return Number.isFinite(earliest) ? earliest : null;
};

const markGeminiRateLimited = (model: string, nowMs: number) => {
  const runtime = ensureGeminiRuntime(model);
  runtime.rateLimitedStreak += 1;
  const cooldownMs = Math.min(
    GEMINI_429_MAX_COOLDOWN_MS,
    GEMINI_429_BASE_COOLDOWN_MS * (2 ** Math.max(0, runtime.rateLimitedStreak - 1)),
  );
  runtime.cooldownUntil = Math.max(runtime.cooldownUntil, nowMs + cooldownMs);
};

const markGeminiSuccess = (model: string) => {
  const runtime = ensureGeminiRuntime(model);
  runtime.rateLimitedStreak = 0;
  runtime.cooldownUntil = 0;
};

const activateGlobalPauseIfAllModelsLimited = (models: string[], nowMs: number) => {
  if (!models.length) return;
  const allLimited = models.every((model) => ensureGeminiRuntime(model).cooldownUntil > nowMs);
  if (!allLimited) return;

  const earliest = getEarliestCooldownUntil(models, nowMs);
  if (earliest) {
    geminiGlobalPauseUntil = Math.max(geminiGlobalPauseUntil, earliest);
  }
};

type GeminiAttemptResult<T> = {
  ok: boolean;
  status: number;
  parsed: T | null;
};

const runWithGeminiModelPool = async <T>(
  models: string[],
  attempt: (model: string) => Promise<GeminiAttemptResult<T>>,
): Promise<T | null> => {
  syncGeminiModelPool(models);
  if (!models.length) return null;

  const nowMs = Date.now();
  if (geminiGlobalPauseUntil > nowMs) return null;
  if (geminiGlobalPauseUntil && geminiGlobalPauseUntil <= nowMs) {
    geminiGlobalPauseUntil = 0;
  }

  const ordered = getRoundRobinOrder(models);
  const available = ordered.filter((model) => ensureGeminiRuntime(model).cooldownUntil <= nowMs);
  if (!available.length) {
    const earliest = getEarliestCooldownUntil(models, nowMs);
    if (earliest) {
      geminiGlobalPauseUntil = Math.max(geminiGlobalPauseUntil, earliest);
    }
    return null;
  }

  let saw429 = false;
  for (const model of available) {
    const runtime = ensureGeminiRuntime(model);
    runtime.lastUsedAt = Date.now();

    const result = await attempt(model);
    if (result.ok && result.parsed !== null) {
      markGeminiSuccess(model);
      return result.parsed;
    }

    if (result.status === 429) {
      saw429 = true;
      markGeminiRateLimited(model, Date.now());
    }
  }

  if (saw429) {
    activateGlobalPauseIfAllModelsLimited(models, Date.now());
  }

  return null;
};

const normalizeUzToken = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[\u02BB\u02BC\u2019`']/g, '')
    .replace(/[^a-z]/g, '');

const splitLatinTokens = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z\u02BB\u02BC\u2019`']+/i)
    .map((token) => token.trim())
    .filter(Boolean);

const hasUzSpecificLatinMarkers = (value: string): boolean =>
  /[\u02BB\u02BC]/u.test(value) ||
  /(o['\u02BB\u02BC\u2019`]|g['\u02BB\u02BC\u2019`])/iu.test(value);

const UZ_WORDS = new Set([
  'salom', 'rahmat', 'yaxshi', 'bugun', 'qanday', 'iltimos', 'dunyo',
  'tushun', 'bilaman', 'kerak', 'bormi', 'nima', 'qayerda', 'xayr',
  'juda', 'ham', 'emas', 'bor', 'yoq', 'yoqmi', 'boladi', 'yoz', 'kel',
  'ket', 'qil', 'qilyapman', 'qildim', 'qilgan', 'uchun', 'bilan', 'siz',
  'biz', 'men', 'sen', 'ular', 'endi', 'hech', 'narsa', 'vaqt', 'ertalab',
  'kechqurun', 'kunduzi', 'kecha', 'ertaga', 'hozir', 'soat', 'oy', 'yil',
  'hafta', 'kun', 'dars', 'maktab', 'ish', 'uy', 'kitob', 'qalam', 'telefon',
  'doim', 'jamoa', 'odam', 'bola', 'ota', 'ona', 'aka', 'uka', 'opa', 'singil',
  'sotib', 'olish', 'yugurish', 'yurish', 'borish', 'kelish', 'qilish',
  'korish', 'oqish', 'yozish', 'ichish', 'yashash', 'ishlash', 'organish',
  'oquvchi', 'soz', 'ozbek', 'tarjima',
]);

const likelyUzSuffix = /(lar|lik|chi|dan|ning|siz|uvchi|amiz|man|san|miz|lari|dagi|gacha|moq)$/i;
const likelyUzVerbNoun = /(ish|moq)$/i;

const hasStrongUzCluster = (token: string): boolean => {
  return /q(?!u)|^x|yo|ya|yu|gur|quv|kor|oq/i.test(token);
};

const scoreUzToken = (token: string): number => {
  let score = 0;
  const raw = token.toLowerCase();
  const t = normalizeUzToken(raw);
  if (!t) return 0;

  if (UZ_WORDS.has(t)) score += 2;
  if (/(?:o|g)['\u02BB\u02BC\u2019`]/iu.test(raw)) score += 2;
  if (/q(?!u)/iu.test(t)) score += 2; // Uzbek "q" is often not followed by "u"
  if (/^x[a-z]/iu.test(t)) score += 1;
  if (/(sh|ch|ng|ya|yo|yu)/iu.test(t)) score += 1;
  if (likelyUzSuffix.test(t)) score += 1;
  if (likelyUzVerbNoun.test(t) && hasStrongUzCluster(t)) score += 1;

  return score;
};

const isLikelyUzbekLatin = (text: string): boolean => {
  const tokens = splitLatinTokens(text);

  if (tokens.length === 0) return false;

  const scores = tokens.map(scoreUzToken);
  const maxScore = Math.max(...scores);
  const totalScore = scores.reduce((acc, value) => acc + value, 0);

  return maxScore >= 2 || totalScore >= 3;
};

const isShortAmbiguousUzToken = (token: string): boolean => {
  const normalized = normalizeUzToken(token);
  if (!normalized) return false;
  if (normalized.length > 3) return false;
  return UZ_WORDS.has(normalized);
};

const resolveAmbiguousLatinLang = (hint: DetectHint): Lang => {
  return hint.preferredNative === 'uz' ? 'uz' : 'en';
};

export const detectLanguageWithMeta = (text: string, hint: DetectHint = {}): DetectLanguageResult => {
  const value = text.trim().toLowerCase();
  if (!value) return { lang: 'en', ambiguous: false };

  // Cyrillic text is treated as Russian.
  if (/[\u0400-\u04FF]/u.test(value)) return { lang: 'ru', ambiguous: false };

  // Uzbek-specific latin markers: apostrophe-based letters (o', g').
  if (hasUzSpecificLatinMarkers(value)) return { lang: 'uz', ambiguous: false };

  const tokens = splitLatinTokens(value);
  if (tokens.length === 1 && isShortAmbiguousUzToken(tokens[0] ?? '')) {
    return {
      lang: resolveAmbiguousLatinLang(hint),
      ambiguous: true,
    };
  }

  if (isLikelyUzbekLatin(value)) return { lang: 'uz', ambiguous: false };

  return { lang: 'en', ambiguous: false };
};

export const detectLanguage = (text: string, hint: DetectHint = {}): Lang => {
  return detectLanguageWithMeta(text, hint).lang;
};

const normalizeForSuspicionCompare = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[\u02BB\u02BC\u2019`']/g, '')
    .replace(/[^a-zа-яё0-9]+/giu, '');

const hasAnyLetters = (value: string): boolean => /[a-zа-яё]/iu.test(value);

const looksLikePathOrTechnicalToken = (value: string): boolean => {
  const text = value.trim();
  if (!text) return false;
  if (/^[a-z]:[\\/]/iu.test(text)) return true;
  if (/\s/u.test(text)) return false;
  if (/[a-z0-9._-]+\/[a-z0-9._-]+/iu.test(text)) return true;
  if (/[a-z0-9._-]+\\[a-z0-9._-]+/iu.test(text)) return true;
  return false;
};

const looksLikeMojibake = (value: string): boolean => {
  const text = value.trim();
  if (!text) return false;
  if (/[�]/u.test(text)) return true;
  const chunks = text.match(/[РС][A-Za-z]/gu);
  return Boolean(chunks && chunks.length >= 3 && !/[а-яё]/iu.test(text));
};

export const isSuspiciousAutoTranslation = (sourceText: string, translatedText: string): boolean => {
  const source = sourceText.trim();
  const translated = translatedText.trim();
  if (!translated) return true;
  if (looksLikeMojibake(translated)) return true;
  if (looksLikePathOrTechnicalToken(translated)) return true;
  if (/https?:\/\/|www\./iu.test(translated)) return true;
  if (!hasAnyLetters(translated)) return true;

  const sourceNorm = normalizeForSuspicionCompare(source);
  const translatedNorm = normalizeForSuspicionCompare(translated);
  if (!sourceNorm || !translatedNorm) return false;

  const bothLatin = /^[a-z0-9]+$/i.test(sourceNorm) && /^[a-z0-9]+$/i.test(translatedNorm);
  if (bothLatin && sourceNorm.length >= 4 && sourceNorm === translatedNorm) return true;

  return false;
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

const parseGeminiDetectTranslateJson = (rawText: string): GeminiDetectTranslatePayload | null => {
  const text = rawText.trim();
  if (!text) return null;

  const candidates = [
    text,
    text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim(),
  ];

  const objectLike = text.match(/\{[\s\S]*\}/);
  if (objectLike) candidates.push(objectLike[0]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as GeminiDetectTranslatePayload;
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // try next candidate
    }
  }

  return null;
};

const normalizeSourceLang = (value: unknown): Lang | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'ru' || normalized === 'en' || normalized === 'uz') return normalized;
  return null;
};

const normalizeConfidence = (value: unknown): number => {
  const num = typeof value === 'string' ? Number.parseFloat(value) : typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(1, num));
};

export type GeminiDetectTranslateResult = {
  sourceLang: Lang;
  targetLang: Lang;
  translatedText: string | null;
  confidence: number;
};

export const detectAndTranslateWithGemini = async (
  input: string,
  nativeLang: 'ru' | 'uz'
): Promise<GeminiDetectTranslateResult | null> => {
  const text = input.trim();
  if (!text) return null;

  const key = trimEnv(process.env.GEMINI_API_KEY);
  if (!key) return null;

  const base = trimEnv(process.env.GEMINI_API_BASE_URL) || GEMINI_DEFAULT_BASE_URL;
  const models = readGeminiModels();
  const timeoutMs = readTimeoutMs();

  const prompt = [
    'Detect source language and translate in one step.',
    'Allowed source_lang values: en, ru, uz only.',
    `If source_lang is "en", translate to "${nativeLang}".`,
    'If source_lang is "ru" or "uz", translate to "en".',
    'Prefer natural, commonly used native equivalents.',
    'Avoid transliteration/loanword copy when a common native equivalent exists.',
    'Return ONLY strict JSON with keys: source_lang, target_lang, translated_text, confidence.',
    'confidence must be a number from 0 to 1.',
    `Text: ${text}`,
  ].join('\n');

  return runWithGeminiModelPool(models, async (model) => {
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

    if (!res.ok) return { ok: false, status: res.status, parsed: null };

    const raw = parseGeminiTranslation(res.data);
    if (!raw) return { ok: true, status: res.status, parsed: null };

    const parsed = parseGeminiDetectTranslateJson(raw);
    if (!parsed) return { ok: true, status: res.status, parsed: null };

    const sourceLang = normalizeSourceLang(parsed.source_lang);
    const targetLang = normalizeSourceLang(parsed.target_lang);
    const translatedText = normalizeText(parsed.translated_text);
    if (!sourceLang || !targetLang || !translatedText) {
      return { ok: true, status: res.status, parsed: null };
    }

    return {
      ok: true,
      status: res.status,
      parsed: {
        sourceLang,
        targetLang,
        translatedText,
        confidence: normalizeConfidence(parsed.confidence),
      },
    };
  });
};

const translateWithGeminiStep = async (
  text: string,
  source: Lang,
  target: Lang,
  timeoutMs: number,
  options?: { preferNativeEquivalent?: boolean }
): Promise<string | null> => {
  const key = trimEnv(process.env.GEMINI_API_KEY);
  if (!key) return null;

  const base = trimEnv(process.env.GEMINI_API_BASE_URL) || GEMINI_DEFAULT_BASE_URL;
  const models = readGeminiModels();

  const prompt = [
    `Translate text from ${languageName(source)} to ${languageName(target)}.`,
    ...(options?.preferNativeEquivalent
      ? [
        'Use natural, everyday native wording.',
        'Avoid transliteration/loanword copy if a common native equivalent exists.',
      ]
      : []),
    'Return only translated text without comments.',
    `Text: ${text}`,
  ].join('\n');

  return runWithGeminiModelPool(models, async (model) => {
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

    if (!res.ok) return { ok: false, status: res.status, parsed: null };
    return { ok: true, status: res.status, parsed: parseGeminiTranslation(res.data) };
  });
};

const translateWithMyMemoryStep = async (text: string, source: Lang, target: Lang, timeoutMs: number): Promise<string | null> => {
  const base = trimEnv(process.env.TRANSLATE_API_URL) || MYMEMORY_DEFAULT_URL;
  const url = `${base}?q=${encodeURIComponent(text)}&langpair=${source}|${target}`;

  const res = await fetchJson<MyMemoryResponse>(url, { method: 'GET' }, timeoutMs);
  if (!res.ok) return null;

  return normalizeText(res.data?.responseData?.translatedText);
};

const translateWithMyMemoryRouting = async (
  text: string,
  source: Lang,
  target: Lang,
  timeoutMs: number
): Promise<string | null> => {
  if (source === target) return null;

  if (source === 'ru' && target === 'uz') {
    const viaEn = await translateWithMyMemoryStep(text, 'ru', 'en', timeoutMs);
    if (!viaEn) return null;
    return translateWithMyMemoryStep(viaEn, 'en', 'uz', timeoutMs);
  }

  if (source === 'uz' && target === 'ru') {
    const viaEn = await translateWithMyMemoryStep(text, 'uz', 'en', timeoutMs);
    if (!viaEn) return null;
    return translateWithMyMemoryStep(viaEn, 'en', 'ru', timeoutMs);
  }

  return translateWithMyMemoryStep(text, source, target, timeoutMs);
};

const translateOneStep = async (text: string, source: Lang, target: Lang, timeoutMs: number): Promise<string | null> => {
  if (source === target) return text;

  const gemini = await translateWithGeminiStep(text, source, target, timeoutMs);
  if (gemini) return gemini;

  const hf = await translateWithHfStep(text, source, target, timeoutMs);
  if (hf) return hf;

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

export const translateAutoWithMyMemory = async (input: string, target: Lang = 'ru'): Promise<string | null> => {
  const text = input.trim();
  if (!text) return null;

  const source = detectLanguage(text);
  if (source === target) return null;

  const cacheKey = `mymemory|${getCacheKey(text, source, target)}`;
  const cached = readCachedTranslation(cacheKey);
  if (cached) return cached;

  const translated = await translateWithMyMemoryRouting(text, source, target, readTimeoutMs());
  if (!translated) return null;

  writeCachedTranslation(cacheKey, translated);
  return translated;
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
    if (!translated) return null;

    let finalTranslation = translated;
    if (source === 'en' && target === 'uz' && isLikelyUzLoanwordFromEnglish(text, translated)) {
      const refined = await translateWithGeminiStep(text, source, target, readTimeoutMs(), {
        preferNativeEquivalent: true,
      });
      if (refined && !isLikelyUzLoanwordFromEnglish(text, refined)) {
        finalTranslation = refined;
      }
    }

    if (source === 'en' && target === 'ru' && isLikelyRuLoanwordFromEnglish(text, translated)) {
      const refined = await translateWithGeminiStep(text, source, target, readTimeoutMs(), {
        preferNativeEquivalent: true,
      });
      if (refined && !isLikelyRuLoanwordFromEnglish(text, refined)) {
        finalTranslation = refined;
      }
    }

    writeCachedTranslation(cacheKey, finalTranslation);
    return finalTranslation;
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
