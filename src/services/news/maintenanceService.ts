import { prisma } from '../../db/client';
import {
    DEFAULT_NEEDS_RESOLVE_SCAN_LIMIT,
    NEWS_STAGE_THRESHOLD,
    readNewsExhaustedRetryHours,
    readNewsJobRetentionDays,
    readNewsMaxJobAttempts,
    readNewsStaleDays,
} from './config';
import { queueWordNewsResolve } from './resolveService';

export const enqueueWordsNeedingNewsResolve = async (limit = DEFAULT_NEEDS_RESOLVE_SCAN_LIMIT): Promise<number> => {
    const words = await prisma.word.findMany({
        where: {
            reviews: {
                some: { stage: { gte: NEWS_STAGE_THRESHOLD } },
            },
            OR: [
                { newsExampleText: null },
                { newsExampleNeedsRefresh: true },
            ],
        },
        select: { id: true },
        take: Math.max(1, limit),
        orderBy: [{ newsExamplePreparedAt: 'asc' }, { id: 'asc' }],
    });

    for (const word of words) {
        await queueWordNewsResolve(word.id);
    }

    return words.length;
};

export const markOldNewsForRefresh = async (): Promise<number> => {
    const staleDays = readNewsStaleDays();
    const cutoffDate = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);

    const affected = await prisma.word.updateMany({
        where: {
            newsExamplePreparedAt: { lt: cutoffDate },
            newsExampleNeedsRefresh: false,
            newsExampleText: { not: null },
        },
        data: {
            newsExampleNeedsRefresh: true,
        },
    });

    return affected.count;
};

export const rearmExhaustedNewsResolveJobs = async (limit = DEFAULT_NEEDS_RESOLVE_SCAN_LIMIT): Promise<number> => {
    const maxJobs = Math.max(1, limit);
    const maxAttempts = readNewsMaxJobAttempts();
    const exhaustedRetryHours = readNewsExhaustedRetryHours();
    const cutoffDate = new Date(Date.now() - exhaustedRetryHours * 60 * 60 * 1000);

    const rearmedRows = await prisma.$queryRaw<{ id: number }[]>`
        WITH exhausted AS (
            SELECT j.id
            FROM "NewsResolveJob" j
            INNER JOIN "Word" w ON w.id = j."wordId"
            WHERE j.status = 'FAILED'
              AND j.attempts >= ${maxAttempts}
              AND j."updatedAt" <= ${cutoffDate}
              AND (w."newsExampleNeedsRefresh" = TRUE OR w."newsExampleText" IS NULL)
            ORDER BY j."updatedAt" ASC, j.id ASC
            LIMIT ${maxJobs}
            FOR UPDATE SKIP LOCKED
        )
        UPDATE "NewsResolveJob" j
        SET status = 'PENDING',
            attempts = 0,
            "lockedAt" = NULL,
            "lastError" = 'rearmed_after_exhausted',
            "scheduledAt" = NOW()
        FROM exhausted
        WHERE j.id = exhausted.id
        RETURNING j.id
    `;

    return rearmedRows.length;
};

export const pruneExpiredNewsCacheAndOldJobs = async (): Promise<void> => {
    const now = new Date();
    const retentionDays = readNewsJobRetentionDays();

    await prisma.newsCache.deleteMany({
        where: {
            expiresAt: { lt: now },
        },
    });

    await prisma.newsResolveJob.deleteMany({
        where: {
            status: { in: ['DONE', 'FAILED'] },
            updatedAt: { lt: new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000) },
        },
    });
};
