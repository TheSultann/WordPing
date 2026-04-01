import { prisma } from '../../../db/client';
import type { GdeltArticle, GdeltResponse, GdeltScope, TierLookupResult } from '../types';
import {
    gdeltApiUrl,
    gdeltQueryScope,
    readGdeltArticleLimit,
    readGdeltCooldownMinutes,
    readGdeltMinIntervalSeconds,
    readGdeltTimeoutMs,
    readGdeltWordRetryHours,
} from '../config';
import { fetchTextWithTimeoutDetailed, hoursFromNow, normalizeText, parseJsonSafe } from '../utils';
import { acquireProviderPermit, markProviderFailure, markProviderSuccess, providerReason } from './rateLimit';
import { selectBestExternalCandidate } from '../matching';
import { isEnglishLike } from './shared';

export const buildGdeltQuery = (wordEn: string, scope: GdeltScope): string => {
    const normalizedWord = wordEn.trim().replace(/"/g, '');
    const quoted = `"${normalizedWord}"`;
    if (scope === 'uzbekistan') {
        const scopePrefix = gdeltQueryScope().trim();
        return `${scopePrefix} ${quoted} sourcelang:English`.trim();
    }
    return `${quoted} sourcelang:English`.trim();
};

export const fetchGdeltResponse = async (query: string): Promise<{ parsed: GdeltResponse | null; status: number | null }> => {
    const params = new URLSearchParams({
        query,
        mode: 'ArtList',
        format: 'json',
        maxrecords: String(readGdeltArticleLimit()),
    });

    const result = await fetchTextWithTimeoutDetailed(`${gdeltApiUrl()}?${params.toString()}`, readGdeltTimeoutMs());
    if (!result) {
        await markProviderFailure('GDELT', null, 'network_error');
        return { parsed: null, status: null };
    }

    if (result.status === 429) {
        const cooldownUntil = await markProviderFailure(
            'GDELT',
            result.status,
            'http_429',
            readGdeltCooldownMinutes(),
        );
        return { parsed: cooldownUntil ? ({ articles: [] } as GdeltResponse) : null, status: result.status };
    }

    if (!result.ok) {
        await markProviderFailure('GDELT', result.status, `http_${result.status}`);
        return { parsed: null, status: result.status };
    }

    await markProviderSuccess('GDELT', result.status);
    return {
        parsed: parseJsonSafe<GdeltResponse>(result.text),
        status: result.status,
    };
};

const extractTextFromGdeltArticle = (article: GdeltArticle): string | null => {
    const candidates = [article.snippet, article.excerpt, article.description, article.title];
    for (const candidate of candidates) {
        const normalized = normalizeText(candidate, 2048);
        if (normalized) return normalized;
    }
    return null;
};

type FindTier3FromGdeltOptions = {
    skipPermit?: boolean;
};

export const findTier3FromGdelt = async (
    wordEn: string,
    scope: GdeltScope,
    options: FindTier3FromGdeltOptions = {},
): Promise<TierLookupResult> => {
    if (!options.skipPermit) {
        const permit = await acquireProviderPermit('GDELT', {
            minIntervalSeconds: readGdeltMinIntervalSeconds(),
        });
        if (!permit.allowed) {
            return {
                example: null,
                deferredReason: permit.reason ?? providerReason('GDELT', 'cooldown'),
                deferredUntil: permit.retryAt ?? hoursFromNow(readGdeltWordRetryHours()),
            };
        }
    }

    const query = buildGdeltQuery(wordEn, scope);
    const result = await fetchGdeltResponse(query);
    if (result.status === 429) {
        const state = await prisma.newsProviderState.findUnique({
            where: { provider: 'GDELT' },
            select: { cooldownUntil: true },
        });
        return {
            example: null,
            deferredReason: providerReason('GDELT', 'cooldown'),
            deferredUntil: state?.cooldownUntil ?? hoursFromNow(readGdeltWordRetryHours()),
        };
    }

    if (!result.parsed?.articles?.length) {
        return { example: null };
    }

    const candidates = result.parsed.articles
        .filter((article) => isEnglishLike(article.language))
        .map((article) => ({
            title: normalizeText(article.title, 512) ?? 'GDELT article',
            snippet: extractTextFromGdeltArticle(article) ?? '',
            bodyText: normalizeText(article.description, 6000),
            url: normalizeText(article.url, 1024) ?? '',
            publishedAt: null,
        }))
        .filter((item) => item.url && item.snippet);

    return {
        example: selectBestExternalCandidate(wordEn, 'GDELT', candidates),
    };
};
