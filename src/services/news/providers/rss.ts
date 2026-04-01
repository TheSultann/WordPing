import type { Prisma } from '../../../generated/prisma/client';
import { prisma } from '../../../db/client';
import type { RefreshNewsCacheResult, ResolvedNewsExample } from '../types';
import {
    readNewsCacheTtlDays,
    readRssBodyStageLimit,
    readRssFastStageLimit,
    readRssFeeds,
    readRssItemLimit,
    readRssPrimaryDomains,
    readRssTimeoutMs,
} from '../config';
import { fetchWithTimeout, parseRssFeed, toHash } from '../utils';
import { buildTier1Profile, selectBestTier1Candidate } from '../matching';
import { createContainsFilter, withWordCandidates } from './shared';

export const refreshNewsCacheFromRss = async (): Promise<RefreshNewsCacheResult> => {
    const feeds = readRssFeeds();
    const limitPerFeed = readRssItemLimit();
    const timeoutMs = readRssTimeoutMs();
    const ttlMs = readNewsCacheTtlDays() * 24 * 60 * 60 * 1000;

    let inserted = 0;
    let updated = 0;
    let totalProcessed = 0;

    for (const url of feeds) {
        try {
            const xml = await fetchWithTimeout(url, timeoutMs);
            if (!xml) continue;

            const items = parseRssFeed(xml, url);
            let processedForFeed = 0;

            for (const item of items) {
                if (processedForFeed >= limitPerFeed) break;

                const contentStr = `${item.url}|${item.title}|${item.snippet}`;
                const contentHash = toHash(contentStr);
                const now = new Date();
                const expiresAt = new Date(now.getTime() + ttlMs);

                try {
                    const rows = await prisma.$queryRaw<{ inserted: boolean }[]>`
                        INSERT INTO "NewsCache" (
                          source, title, url, snippet, "bodyText", language, "publishedAt", "fetchedAt", "expiresAt", "contentHash"
                        )
                        VALUES (
                          ${item.source}, ${item.title}, ${item.url}, ${item.snippet}, ${item.bodyText}, ${item.language}, ${item.publishedAt}, ${now}, ${expiresAt}, ${contentHash}
                        )
                        ON CONFLICT ("url")
                        DO UPDATE SET
                          source = EXCLUDED.source,
                          title = EXCLUDED.title,
                          snippet = EXCLUDED.snippet,
                          "bodyText" = EXCLUDED."bodyText",
                          language = EXCLUDED.language,
                          "publishedAt" = EXCLUDED."publishedAt",
                          "fetchedAt" = EXCLUDED."fetchedAt",
                          "expiresAt" = EXCLUDED."expiresAt",
                          "contentHash" = EXCLUDED."contentHash"
                        RETURNING (xmax = 0) AS inserted
                    `;

                    if (rows[0]?.inserted) {
                        inserted += 1;
                    } else {
                        updated += 1;
                    }
                    totalProcessed += 1;
                    processedForFeed += 1;
                } catch {
                    // Keep worker resilient even if one item fails.
                }
            }
        } catch {
            // Continue to next feed
        }
    }

    return { inserted, updated, totalProcessed };
};

export const findTier1FromNewsCache = async (wordEn: string): Promise<ResolvedNewsExample | null> => {
    const now = new Date();
    const profile = buildTier1Profile(wordEn);
    if (!profile.dbTerms.length) return null;

    const primaryDomains = readRssPrimaryDomains();
    const domainFilter = primaryDomains.length
        ? [{
            OR: primaryDomains.map((domain) => createContainsFilter('url', domain)),
        }]
        : [];
    const commonFilters: Prisma.NewsCacheWhereInput[] = [
        ...domainFilter,
        {
            OR: [
                { expiresAt: null },
                { expiresAt: { gt: now } },
            ],
        },
    ];

    const fastCandidates = await prisma.newsCache.findMany({
        where: {
            AND: [
                ...commonFilters,
                { OR: withWordCandidates(profile.dbTerms, ['title', 'snippet']) },
            ],
        },
        select: {
            id: true,
            title: true,
            snippet: true,
            bodyText: true,
            url: true,
            publishedAt: true,
            fetchedAt: true,
        },
        orderBy: [{ publishedAt: 'desc' }, { fetchedAt: 'desc' }],
        take: readRssFastStageLimit(),
    });

    const bestFast = selectBestTier1Candidate(fastCandidates, profile, now);
    if (bestFast) {
        return {
            text: bestFast.selectedText,
            tier: 'CACHE',
            sourceUrl: bestFast.item.url,
            sourceTitle: bestFast.item.title,
            matchedWord: bestFast.matchedWord,
        };
    }

    const bodyCandidates = await prisma.newsCache.findMany({
        where: {
            AND: [
                ...commonFilters,
                { OR: withWordCandidates(profile.dbTerms, ['bodyText']) },
            ],
        },
        select: {
            id: true,
            title: true,
            snippet: true,
            bodyText: true,
            url: true,
            publishedAt: true,
            fetchedAt: true,
        },
        orderBy: [{ publishedAt: 'desc' }, { fetchedAt: 'desc' }],
        take: readRssBodyStageLimit(),
    });

    const bestBody = selectBestTier1Candidate(bodyCandidates, profile, now);
    if (!bestBody) return null;

    return {
        text: bestBody.selectedText,
        tier: 'CACHE',
        sourceUrl: bestBody.item.url,
        sourceTitle: bestBody.item.title,
        matchedWord: bestBody.matchedWord,
    };
};
