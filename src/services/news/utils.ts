import * as crypto from 'crypto';
import { XMLParser } from 'fast-xml-parser';

export const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const stripHtml = (value: string): string =>
    value
        .replace(/<!\[CDATA\[|\]\]>/g, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();

export const normalizeText = (value: unknown, maxLen: number): string | null => {
    if (typeof value !== 'string') return null;
    const text = stripHtml(value).trim();
    if (!text) return null;
    return text.length > maxLen ? text.slice(0, maxLen) : text;
};

export const normalizeWordForMatch = (input: string): string =>
    input
        .toLowerCase()
        .replace(/[’`]/g, "'")
        .replace(/[^a-z0-9\s'-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

export const extractTokens = (input: string): string[] => {
    const normalized = normalizeWordForMatch(input);
    if (!normalized) return [];
    return Array.from(new Set(normalized.split(' ').map((item) => item.trim()).filter(Boolean)));
};

export const buildSingularForms = (word: string): string[] => {
    const forms = new Set<string>();

    if (word.endsWith('ies') && word.length > 3) {
        forms.add(`${word.slice(0, -3)}y`);
    }

    if (/(ches|shes|xes|zes|ses)$/.test(word) && word.length > 3) {
        forms.add(word.slice(0, -2));
    }

    if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us') && word.length > 3) {
        forms.add(word.slice(0, -1));
    }

    return Array.from(forms);
};

export const buildPluralForms = (word: string): string[] => {
    const forms = new Set<string>();
    if (word.endsWith('s')) return [];

    if (word.endsWith('y') && word.length > 2) {
        forms.add(`${word.slice(0, -1)}ies`);
    }

    if (/(s|x|z|ch|sh)$/.test(word)) {
        forms.add(`${word}es`);
    }
    forms.add(`${word}s`);
    return Array.from(forms);
};

const canDoubleLastConsonant = (word: string): boolean => {
    if (word.length < 3) return false;
    const chars = word.split('');
    const last = chars[chars.length - 1] ?? '';
    const mid = chars[chars.length - 2] ?? '';
    const prev = chars[chars.length - 3] ?? '';
    if (!/[bcdfghjklmnpqrstvwxyz]/.test(last) || /[wxy]/.test(last)) return false;
    if (!/[aeiou]/.test(mid)) return false;
    if (!/[bcdfghjklmnpqrstvwxyz]/.test(prev)) return false;
    return true;
};

const buildVerbForms = (word: string): string[] => {
    const forms = new Set<string>();
    if (!word) return [];

    const consonantY = /[^aeiou]y$/.test(word);
    if (consonantY) {
        const stem = word.slice(0, -1);
        forms.add(`${stem}ied`);
        forms.add(`${stem}ying`);
    } else if (word.endsWith('e')) {
        forms.add(`${word}d`);
        forms.add(`${word.slice(0, -1)}ing`);
    } else {
        forms.add(`${word}ed`);
        forms.add(`${word}ing`);
    }

    if (canDoubleLastConsonant(word)) {
        const last = word[word.length - 1]!;
        forms.add(`${word}${last}ed`);
        forms.add(`${word}${last}ing`);
    }

    return Array.from(forms);
};

const SOFT_ENDING_SUFFIXES = [
    'er',
    'est',
    'ly',
    'ment',
    'tion',
    'sion',
    'al',
    'ial',
    'ic',
    'ical',
    'ness',
    'able',
    'ible',
];

export const buildStrictWordForms = (input: string): string[] => {
    const base = normalizeWordForMatch(input);
    if (!base) return [];
    const forms = new Set<string>([base]);

    for (const singular of buildSingularForms(base)) forms.add(singular);
    for (const plural of buildPluralForms(base)) forms.add(plural);
    for (const verb of buildVerbForms(base)) forms.add(verb);

    return Array.from(forms);
};

export const buildSoftEndingForms = (input: string): string[] => {
    const base = normalizeWordForMatch(input);
    if (!base) return [];
    const forms = new Set<string>();

    for (const suffix of SOFT_ENDING_SUFFIXES) {
        const candidate = `${base}${suffix}`;
        if (candidate.length >= 3 && candidate.length <= 28) {
            forms.add(candidate);
        }
    }

    if (base.endsWith('y') && base.length > 2) {
        const stem = base.slice(0, -1);
        forms.add(`${stem}ic`);
        forms.add(`${stem}ical`);
        forms.add(`${stem}ity`);
    }

    if (base.endsWith('e')) {
        forms.add(`${base}r`);
    }

    return Array.from(forms);
};

export const buildWordForms = (input: string): string[] => {
    const strict = buildStrictWordForms(input);
    const soft = buildSoftEndingForms(input);
    return Array.from(new Set([...strict, ...soft]));
};

export const buildTokenForms = (tokens: string[]): string[] => {
    const forms = new Set<string>();
    for (const token of tokens) {
        for (const form of buildWordForms(token)) {
            forms.add(form);
        }
    }
    return Array.from(forms);
};

export const escapeHtml = (unsafe: string): string => {
    return unsafe
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

export const fetchTextWithTimeoutDetailed = async (url: string, timeoutMs: number): Promise<{ ok: boolean; status: number; text: string; } | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal });
        const text = await response.text();
        return {
            ok: response.ok,
            status: response.status,
            text,
        };
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
};

export const fetchWithTimeout = async (url: string, timeoutMs: number): Promise<string | null> => {
    const result = await fetchTextWithTimeoutDetailed(url, timeoutMs);
    if (!result?.ok) return null;
    return result.text;
};

export const parseDateSafe = (value: unknown): Date | null => {
    if (typeof value !== 'string' || !value.trim()) return null;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
};

export const toArray = <T>(value: T | T[] | undefined | null): T[] => {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
};

export const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    trimValues: true,
});

export const textFromXmlValue = (value: unknown): string | null => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
        for (const item of value) {
            const text = textFromXmlValue(item);
            if (text) return text;
        }
        return null;
    }
    if (!value || typeof value !== 'object') return null;

    const row = value as Record<string, unknown>;
    if (typeof row['#text'] === 'string') return row['#text'];
    if (typeof row['$text'] === 'string') return row['$text'];
    return null;
};

export const rssLinkFromValue = (value: unknown): string | null => {
    if (typeof value === 'string') return value;
    if (!value) return null;

    if (Array.isArray(value)) {
        for (const item of value) {
            const link = rssLinkFromValue(item);
            if (link) return link;
        }
        return null;
    }

    if (typeof value === 'object') {
        const row = value as Record<string, unknown>;
        if (typeof row['@_href'] === 'string') return row['@_href'];
        if (typeof row['href'] === 'string') return row['href'];
        const text = textFromXmlValue(row);
        if (text) return text;
    }

    return null;
};

export const parseJsonSafe = <T>(value: string): T | null => {
    try {
        return JSON.parse(value) as T;
    } catch {
        return null;
    }
};

export const toHash = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');

export const utcDayStart = (date: Date): Date =>
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

export const nextUtcDayStart = (date: Date): Date =>
    new Date(utcDayStart(date).getTime() + 24 * 60 * 60 * 1000);

export const hoursFromNow = (hours: number): Date => new Date(Date.now() + hours * 60 * 60 * 1000);

// Needs type RssNormalizedItem 
import type { RssNormalizedItem } from './types';

export const parseRssFeed = (xml: string, sourceUrl: string): RssNormalizedItem[] => {
    const items: RssNormalizedItem[] = [];
    const parsed = xmlParser.parse(xml) as Record<string, any>;
    const rssChannel = parsed?.rss?.channel;
    const atomFeed = parsed?.feed;

    const feedSource =
        normalizeText(textFromXmlValue(rssChannel?.title), 128) ??
        normalizeText(textFromXmlValue(atomFeed?.title), 128) ??
        normalizeText(sourceUrl, 128) ??
        'rss';

    const channelLanguage = normalizeText(textFromXmlValue(rssChannel?.language), 16);
    const atomLanguage =
        normalizeText(atomFeed?.['@_xml:lang'], 16) ??
        normalizeText(textFromXmlValue(atomFeed?.language), 16);

    for (const row of toArray(rssChannel?.item)) {
        const title = normalizeText(textFromXmlValue(row?.title), 512);
        const url = normalizeText(rssLinkFromValue(row?.link), 1024);
        const summary =
            normalizeText(textFromXmlValue(row?.description), 2048) ??
            normalizeText(textFromXmlValue(row?.summary), 2048) ??
            normalizeText(textFromXmlValue(row?.content), 2048);
        const bodyText =
            normalizeText(textFromXmlValue(row?.['content:encoded']), 6000) ??
            normalizeText(textFromXmlValue(row?.content), 6000);
        const language = normalizeText(textFromXmlValue(row?.language), 16) ?? channelLanguage;
        const publishedAt =
            parseDateSafe(textFromXmlValue(row?.pubDate)) ??
            parseDateSafe(textFromXmlValue(row?.isoDate)) ??
            parseDateSafe(textFromXmlValue(row?.published));

        if (!title || !url || !summary) continue;

        items.push({
            source: feedSource,
            title,
            url,
            snippet: summary,
            bodyText,
            language,
            publishedAt,
        });
    }

    for (const row of toArray(atomFeed?.entry)) {
        const title = normalizeText(textFromXmlValue(row?.title), 512);
        const url = normalizeText(rssLinkFromValue(row?.link), 1024);
        const summary =
            normalizeText(textFromXmlValue(row?.summary), 2048) ??
            normalizeText(textFromXmlValue(row?.content), 2048);
        const bodyText = normalizeText(textFromXmlValue(row?.content), 6000);
        const language = normalizeText(textFromXmlValue(row?.language), 16) ?? atomLanguage;
        const publishedAt =
            parseDateSafe(textFromXmlValue(row?.published)) ??
            parseDateSafe(textFromXmlValue(row?.updated));

        if (!title || !url || !summary) continue;

        items.push({
            source: feedSource,
            title,
            url,
            snippet: summary,
            bodyText,
            language,
            publishedAt,
        });
    }

    return items;
};
