import type { GuardianApiResponse, TierLookupResult } from '../types';
import {
    guardianApiKey,
    guardianApiUrl,
    readGuardianPageSize,
    readGuardianSkipWithoutKey,
    readGuardianTimeoutMs,
} from '../config';
import { fetchTextWithTimeoutDetailed, normalizeText, parseJsonSafe } from '../utils';
import { acquireProviderPermit, markProviderFailure, markProviderSuccess } from './rateLimit';
import { selectBestExternalCandidate } from '../matching';

export const findTier4FromGuardian = async (wordEn: string): Promise<TierLookupResult> => {
    const key = guardianApiKey();
    if (readGuardianSkipWithoutKey() && (!key || key === 'test')) {
        return { example: null };
    }

    const permit = await acquireProviderPermit('GUARDIAN');
    if (!permit.allowed) {
        return {
            example: null,
            deferredReason: permit.reason,
            deferredUntil: permit.retryAt,
        };
    }

    const params = new URLSearchParams({
        q: wordEn.trim(),
        'api-key': key,
        'page-size': String(readGuardianPageSize()),
        'order-by': 'relevance',
        'show-fields': 'trailText',
    });
    const result = await fetchTextWithTimeoutDetailed(`${guardianApiUrl()}?${params.toString()}`, readGuardianTimeoutMs());
    if (!result) {
        await markProviderFailure('GUARDIAN', null, 'network_error');
        return { example: null };
    }
    if (result.status === 401 || result.status === 403) {
        await markProviderFailure('GUARDIAN', result.status, `http_${result.status}`);
        return { example: null };
    }
    if (!result.ok) {
        await markProviderFailure('GUARDIAN', result.status, `http_${result.status}`);
        return { example: null };
    }
    await markProviderSuccess('GUARDIAN', result.status);

    const parsed = parseJsonSafe<GuardianApiResponse>(result.text);
    if (!parsed) return { example: null };

    const candidates = (parsed.response?.results ?? [])
        .map((item) => ({
            title: normalizeText(item.webTitle, 512) ?? 'Guardian article',
            snippet: normalizeText(item.fields?.trailText, 2048) ?? normalizeText(item.webTitle, 2048) ?? '',
            bodyText: null,
            url: normalizeText(item.webUrl, 1024) ?? '',
            publishedAt: null,
        }))
        .filter((item) => item.url && item.snippet);

    return {
        example: selectBestExternalCandidate(wordEn, 'GUARDIAN', candidates),
    };
};
