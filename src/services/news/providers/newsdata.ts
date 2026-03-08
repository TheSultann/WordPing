import { trimEnv } from '../../../utils/env';
import { NewsDataArticle, NewsDataResponse, TierLookupResult } from '../types';
import {
    newsDataApiKey,
    newsDataApiUrl,
    readNewsDataDailyBudget,
    readNewsDataDailyLimit,
    readNewsDataTimeoutMs,
} from '../config';
import { fetchTextWithTimeoutDetailed, nextUtcDayStart, normalizeText, parseJsonSafe } from '../utils';
import { acquireProviderPermit, markProviderFailure, markProviderSuccess, providerReason } from './rateLimit';
import { selectBestExternalCandidate } from '../matching';
import { isEnglishLike } from './shared';

export const fetchNewsDataLatest = async (params: URLSearchParams): Promise<{ parsed: NewsDataResponse | null; status: number | null }> => {
    const result = await fetchTextWithTimeoutDetailed(`${newsDataApiUrl()}?${params.toString()}`, readNewsDataTimeoutMs());
    if (!result) {
        await markProviderFailure('NEWSDATA', null, 'network_error');
        return { parsed: null, status: null };
    }
    if (!result.ok) {
        await markProviderFailure('NEWSDATA', result.status, `http_${result.status}`);
        return { parsed: null, status: result.status };
    }
    await markProviderSuccess('NEWSDATA', result.status);
    return {
        parsed: parseJsonSafe<NewsDataResponse>(result.text),
        status: result.status,
    };
};

const extractTextFromNewsDataArticle = (article: NewsDataArticle): string | null => {
    const candidates = [article.description, article.content, article.title];
    for (const candidate of candidates) {
        const normalized = normalizeText(candidate, 2048);
        if (normalized) return normalized;
    }
    return null;
};

export const findFromNewsDataScope = async (
    wordEn: string,
    scope: 'uz' | 'global',
): Promise<TierLookupResult> => {
    const apiKey = newsDataApiKey();
    if (!apiKey) return { example: null };

    const permit = await acquireProviderPermit('NEWSDATA', {
        dailyLimit: readNewsDataDailyLimit(),
        dailyBudget: readNewsDataDailyBudget(),
    });
    if (!permit.allowed) {
        return {
            example: null,
            deferredReason: permit.reason ?? providerReason('NEWSDATA', 'quota_exhausted'),
            deferredUntil: permit.retryAt ?? nextUtcDayStart(new Date()),
        };
    }

    const params = new URLSearchParams({
        apikey: apiKey,
        q: wordEn.trim(),
        language: 'en',
    });
    if (scope === 'uz') {
        params.set('country', 'uz');
    }

    const result = await fetchNewsDataLatest(params);
    if (result.status === 429) {
        return {
            example: null,
            deferredReason: providerReason('NEWSDATA', 'quota_exhausted'),
            deferredUntil: nextUtcDayStart(new Date()),
        };
    }

    if (!result.parsed) return { example: null };
    const responseCode = trimEnv(result.parsed.code).toLowerCase();
    if (responseCode.includes('limit') || responseCode.includes('quota')) {
        return {
            example: null,
            deferredReason: providerReason('NEWSDATA', 'quota_exhausted'),
            deferredUntil: nextUtcDayStart(new Date()),
        };
    }

    const candidates = (result.parsed.results ?? [])
        .filter((article) => isEnglishLike(article.language))
        .map((article) => ({
            title: normalizeText(article.title, 512) ?? 'NewsData article',
            snippet: extractTextFromNewsDataArticle(article) ?? '',
            bodyText: normalizeText(article.content, 6000),
            url: normalizeText(article.link, 1024) ?? '',
            publishedAt: null,
        }))
        .filter((item) => item.url && item.snippet);

    return {
        example: selectBestExternalCandidate(wordEn, 'NEWSDATA', candidates),
    };
};

export const findTier2FromNewsData = async (wordEn: string): Promise<TierLookupResult> => {
    const uzResult = await findFromNewsDataScope(wordEn, 'uz');
    if (uzResult.example) return uzResult;
    const globalResult = await findFromNewsDataScope(wordEn, 'global');
    if (globalResult.example) return globalResult;

    if (uzResult.deferredUntil && globalResult.deferredUntil) {
        return uzResult.deferredUntil.getTime() <= globalResult.deferredUntil.getTime() ? uzResult : globalResult;
    }
    return uzResult.deferredUntil ? uzResult : globalResult;
};
