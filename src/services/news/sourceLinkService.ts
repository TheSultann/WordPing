import { prisma } from '../../db/client';
import {
    NEWS_STAGE_THRESHOLD,
    readSourceLinkCheckBatch,
    readSourceLinkTimeoutMs,
} from './config';

const BROKEN_SOURCE_STATUSES = new Set([404, 410]);

const fetchStatusWithTimeout = async (
    url: string,
    timeoutMs: number,
    method: 'HEAD' | 'GET',
): Promise<number | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            method,
            redirect: 'follow',
            signal: controller.signal,
        });
        return response.status;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
};

const isBrokenSourceUrl = async (url: string, timeoutMs: number): Promise<boolean> => {
    const headStatus = await fetchStatusWithTimeout(url, timeoutMs, 'HEAD');
    if (headStatus === null) return false;
    if (BROKEN_SOURCE_STATUSES.has(headStatus)) return true;

    // Some sources do not support HEAD; fallback to GET for reliable status.
    if (headStatus === 405 || headStatus === 501) {
        const getStatus = await fetchStatusWithTimeout(url, timeoutMs, 'GET');
        return getStatus !== null && BROKEN_SOURCE_STATUSES.has(getStatus);
    }

    return false;
};

const markWordForRefresh = async (wordId: number): Promise<void> => {
    const scheduledAt = new Date();

    await prisma.$transaction([
        prisma.word.update({
            where: { id: wordId },
            data: {
                newsExampleSourceUrl: null,
                newsExampleNeedsRefresh: true,
            },
        }),
        prisma.newsResolveJob.upsert({
            where: { wordId },
            create: {
                wordId,
                status: 'PENDING',
                attempts: 0,
                scheduledAt,
            },
            update: {
                status: 'PENDING',
                attempts: 0,
                lockedAt: null,
                lastError: 'source_url_broken',
                scheduledAt,
            },
        }),
    ]);
};

export const markBrokenNewsSourcesForRefresh = async (
    limit = readSourceLinkCheckBatch(),
): Promise<number> => {
    const maxItems = Math.max(1, limit);
    const timeoutMs = readSourceLinkTimeoutMs();

    const words = await prisma.word.findMany({
        where: {
            newsExampleSourceUrl: { not: null },
            newsExampleText: { not: null },
            newsExampleNeedsRefresh: false,
            reviews: {
                some: { stage: { gte: NEWS_STAGE_THRESHOLD } },
            },
        },
        select: {
            id: true,
            newsExampleSourceUrl: true,
        },
        orderBy: [{ newsExamplePreparedAt: 'asc' }, { id: 'asc' }],
        take: maxItems,
    });

    let marked = 0;
    for (const word of words) {
        const url = word.newsExampleSourceUrl?.trim();
        if (!url) continue;

        const broken = await isBrokenSourceUrl(url, timeoutMs);
        if (!broken) continue;

        await markWordForRefresh(word.id);
        marked += 1;
    }

    return marked;
};
