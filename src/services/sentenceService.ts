import { Prisma } from '../generated/prisma/client';
import { prisma } from '../db/client';
import { trimEnv } from '../utils/env';
import type {
    GeminiResponse} from './translation';
import {
    fetchJson,
    readGeminiModels,
    readTimeoutMs,
    runWithGeminiModelPool
} from './translation';

const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
export const SENTENCES_PER_WORD = 3;
export const MIN_SENTENCES_AFTER_SWAP = 2;
export const MIN_SENTENCES_FOR_SWAP = MIN_SENTENCES_AFTER_SWAP + 1;

export type ExampleSentence = {
    en: string;
    native: string;
};

type GenerateSentenceOptions = {
    count?: number;
    avoidEnglish?: string[];
};

type WordNeedingSentencesRow = {
    id: number;
    wordEn: string;
    translationRu: string;
    userId: bigint;
    createdAt: Date;
    language: string | null;
    timezone: string | null;
    quietHoursStartMinutes: number | null;
    quietHoursEndMinutes: number | null;
    exampleSentences: Prisma.JsonValue | null;
};

type CountRow = {
    count: bigint;
};

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const buildPrompt = (
    wordEn: string,
    translation: string,
    userLang: 'ru' | 'uz',
    count: number,
    avoidEnglish: string[] = [],
): string => {
    const langLabel = userLang === 'uz' ? 'Uzbek' : 'Russian';
    const avoidBlock = avoidEnglish.length > 0
        ? `Avoid reusing these English sentences:\n${avoidEnglish.map((line) => `- ${line}`).join('\n')}`
        : '';
    return [
        `Generate exactly ${count} simple, short English sentences (5-8 words each) using the word "${wordEn}" in the meaning "${translation}".`,
        `For each sentence, provide the ${langLabel} translation.`,
        `The ${langLabel} sentence MUST include the exact phrase "${translation}" (same spelling, case may differ).`,
        'Use everyday vocabulary. No idioms, no complex grammar.',
        ...(avoidBlock ? [avoidBlock] : []),
        'Return ONLY a JSON array with no markdown or code fences.',
        `Format: ${JSON.stringify(Array.from({ length: Math.max(1, count) }, () => ({ en: '...', native: '...' })))}`,
    ].join('\n');
};

// ---------------------------------------------------------------------------
// Parse & Validate
// ---------------------------------------------------------------------------

const extractJsonArray = (raw: string): unknown[] | null => {
    let text = raw.trim();
    // Strip markdown code fences
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch?.[1]) text = fenceMatch[1].trim();
    try {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
};

const parseGeminiText = (data: GeminiResponse | null): string | null => {
    if (!data?.candidates?.length) return null;
    const parts = data.candidates[0]?.content?.parts ?? [];
    return parts.map((p) => p.text ?? '').join(' ').trim() || null;
};

const normalizeComparable = (value: string): string => value.toLowerCase().replace(/\s+/g, ' ').trim();

const isValidSentence = (item: unknown, wordEn: string, translation: string): item is ExampleSentence => {
    if (!item || typeof item !== 'object') return false;
    const obj = item as Record<string, unknown>;
    if (typeof obj.en !== 'string' || typeof obj.native !== 'string') return false;
    if (obj.en.length < 5 || obj.en.length > 200) return false;
    if (obj.native.length < 2 || obj.native.length > 300) return false;

    // The word must appear in the English sentence (case-insensitive)
    const lower = obj.en.toLowerCase();
    const wordLower = wordEn.toLowerCase();
    const nativeLower = normalizeComparable(obj.native);
    const targetLower = normalizeComparable(translation);
    if (!targetLower) return lower.includes(wordLower);

    return lower.includes(wordLower) && nativeLower.includes(targetLower);
};

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

export const generateSentences = async (
    wordEn: string,
    translation: string,
    userLang: 'ru' | 'uz',
    options: GenerateSentenceOptions = {},
): Promise<ExampleSentence[] | null> => {
    const key = trimEnv(process.env.GEMINI_API_KEY);
    if (!key) return null;

    const requestedCount = Math.min(Math.max(options.count ?? SENTENCES_PER_WORD, 1), SENTENCES_PER_WORD);
    const base = trimEnv(process.env.GEMINI_API_BASE_URL) || GEMINI_DEFAULT_BASE_URL;
    const models = readGeminiModels();
    const timeoutMs = readTimeoutMs();
    const prompt = buildPrompt(wordEn, translation, userLang, requestedCount, options.avoidEnglish ?? []);

    const rawText = await runWithGeminiModelPool<string>(models, async (model) => {
        const res = await fetchJson<GeminiResponse>(
            `${base}/${model}:generateContent?key=${encodeURIComponent(key)}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.7, topP: 0.9, topK: 40 },
                }),
            },
            timeoutMs,
        );

        if (!res.ok) return { ok: false, status: res.status, parsed: null };
        return { ok: true, status: res.status, parsed: parseGeminiText(res.data) };
    });

    if (!rawText) return null;

    const arr = extractJsonArray(rawText);
    if (!arr) return null;

    const valid = arr.filter((item) => isValidSentence(item, wordEn, translation)) as ExampleSentence[];
    return valid.length > 0 ? valid.slice(0, requestedCount) : null;
};

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

export const saveSentences = async (
    wordId: number,
    sentences: ExampleSentence[],
): Promise<void> => {
    await prisma.word.update({
        where: { id: wordId },
        data: {
            exampleSentences: sentences as unknown as Prisma.InputJsonValue,
            sentenceIndex: 0,
        },
    });
};

const dedupeSentences = (sentences: ExampleSentence[]): ExampleSentence[] => {
    const seen = new Set<string>();
    const unique: ExampleSentence[] = [];
    for (const sentence of sentences) {
        const key = `${sentence.en.trim().toLowerCase()}|${sentence.native.trim().toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(sentence);
    }
    return unique;
};

export const appendSentences = async (
    wordId: number,
    newSentences: ExampleSentence[],
    maxCount = SENTENCES_PER_WORD,
): Promise<void> => {
    if (!newSentences.length) return;
    const word = await prisma.word.findUnique({ where: { id: wordId } });
    if (!word) return;

    const existing = toExampleSentenceArray(word.exampleSentences);
    const merged = dedupeSentences([...existing, ...newSentences]).slice(0, Math.max(1, maxCount));
    if (merged.length === existing.length && merged.every((item, index) => item.en === existing[index]?.en && item.native === existing[index]?.native)) {
        return;
    }

    const safeIndex = merged.length > 0 ? word.sentenceIndex % merged.length : 0;
    await prisma.word.update({
        where: { id: wordId },
        data: {
            exampleSentences: merged as unknown as Prisma.InputJsonValue,
            sentenceIndex: safeIndex,
        },
    });
};

export const toExampleSentenceArray = (value: Prisma.JsonValue | null): ExampleSentence[] => {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is ExampleSentence => {
        if (!item || typeof item !== 'object') return false;
        const row = item as Record<string, unknown>;
        return typeof row.en === 'string' && typeof row.native === 'string';
    });
};

export const getSentenceCount = (word: { exampleSentences: Prisma.JsonValue | null }): number => {
    return toExampleSentenceArray(word.exampleSentences).length;
};

export type RemoveSentenceResult = {
    sentences: ExampleSentence[];
    removed: boolean;
};

export const removeSentenceAtIndex = async (
    wordId: number,
    index: number,
): Promise<RemoveSentenceResult> => {
    const word = await prisma.word.findUnique({ where: { id: wordId } });
    if (!word?.exampleSentences) return { sentences: [], removed: false };

    const sentences = toExampleSentenceArray(word.exampleSentences);
    if (index < 0 || index >= sentences.length) return { sentences, removed: false };
    if (sentences.length <= MIN_SENTENCES_AFTER_SWAP) {
        return { sentences, removed: false };
    }

    sentences.splice(index, 1);
    const newIndex = sentences.length > 0 ? word.sentenceIndex % sentences.length : 0;

    await prisma.word.update({
        where: { id: wordId },
        data: {
            exampleSentences: sentences.length > 0
                ? (sentences as unknown as Prisma.InputJsonValue)
                : Prisma.JsonNull,
            sentenceIndex: newIndex,
        },
    });

    return { sentences, removed: true };
};

export const advanceSentenceIndex = async (wordId: number): Promise<void> => {
    const word = await prisma.word.findUnique({ where: { id: wordId } });
    if (!word?.exampleSentences) return;

    const sentences = toExampleSentenceArray(word.exampleSentences);
    if (sentences.length === 0) return;

    const nextIndex = (word.sentenceIndex + 1) % sentences.length;
    await prisma.word.update({
        where: { id: wordId },
        data: { sentenceIndex: nextIndex },
    });
};

export const getSentenceForReview = (
    word: { exampleSentences: Prisma.JsonValue | null; sentenceIndex: number },
): { sentence: ExampleSentence; index: number } | null => {
    if (!word.exampleSentences) return null;

    const sentences = toExampleSentenceArray(word.exampleSentences);
    if (sentences.length === 0) return null;

    const index = word.sentenceIndex % sentences.length;
    const item = sentences[index];
    if (!item) return null;
    return { sentence: item, index };
};

export const countWordsNeedingSentences = async (): Promise<number> => {
    const rows = await prisma.$queryRaw<CountRow[]>`
        SELECT COUNT(*)::bigint AS count
        FROM "Word" w
        WHERE
            w."exampleSentences" IS NULL
            OR CASE
                WHEN jsonb_typeof(w."exampleSentences") = 'array'
                  THEN jsonb_array_length(w."exampleSentences") < ${SENTENCES_PER_WORD}
                ELSE TRUE
            END
    `;
    return Number(rows[0]?.count ?? 0n);
};

export const findWordsNeedingSentences = async (limit: number) => {
    const take = Math.min(Math.max(limit, 1), 100);
    const rows = await prisma.$queryRaw<WordNeedingSentencesRow[]>`
        SELECT
            w.id,
            w."wordEn",
            w."translationRu",
            w."userId",
            w."createdAt",
            u."language",
            u."timezone",
            u."quietHoursStartMinutes",
            u."quietHoursEndMinutes",
            w."exampleSentences"
        FROM "Word" w
        JOIN "User" u ON u.id = w."userId"
        WHERE
            w."exampleSentences" IS NULL
            OR CASE
                WHEN jsonb_typeof(w."exampleSentences") = 'array'
                  THEN jsonb_array_length(w."exampleSentences") < ${SENTENCES_PER_WORD}
                ELSE TRUE
            END
        ORDER BY w."createdAt" ASC
        LIMIT ${take}
    `;

    return rows.map((row) => ({
        id: row.id,
        wordEn: row.wordEn,
        translationRu: row.translationRu,
        userId: row.userId,
        createdAt: row.createdAt,
        exampleSentences: row.exampleSentences,
        user: {
            language: row.language,
            timezone: row.timezone,
            quietHoursStartMinutes: row.quietHoursStartMinutes,
            quietHoursEndMinutes: row.quietHoursEndMinutes,
        },
    }));
};
