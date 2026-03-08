import { prisma } from '../../db/client';
import {
    NEWS_STAGE_THRESHOLD,
    DEFAULT_RESOLVE_BATCH,
    DEFAULT_NEEDS_RESOLVE_SCAN_LIMIT,
    readNewsExhaustedRetryHours,
    readNewsJobRetentionDays,
    readNewsMaxJobAttempts,
    readNewsNotFoundRetryStepsMinutes,
    readNewsRetryBaseMinutes,
    readNewsRetryMaxMinutes,
    readNewsStaleDays,
    readSourceLinkCheckBatch,
    readSourceLinkTimeoutMs,
} from './config';
import { hoursFromNow, nextUtcDayStart } from './utils';
import { ResolveOutcome, ResolvePendingNewsExamplesResult } from './types';
import { findTier1FromNewsCache } from './providers/rss';
import { findTier2FromNewsData } from './providers/newsdata';
import { findTier3FromGdelt } from './providers/gdelt';
import { findTier4FromGuardian } from './providers/guardian';

const mergeDeferred = (
    current: { reason?: string | undefined; until?: Date | undefined },
    next: { reason?: string | undefined; until?: Date | undefined },
): { reason?: string | undefined; until?: Date | undefined } => {
    if (!next.until) return current;
    if (!current.until || next.until.getTime() < current.until.getTime()) {
        return { reason: next.reason, until: next.until };
    }
    return current;
};

export const resolveWordNewsExample = async (word: {
    wordEn: string;
}): Promise<ResolveOutcome> => {
    const tier1 = await findTier1FromNewsCache(word.wordEn);
    if (tier1) return { resolved: tier1 };

    let deferred: { reason?: string | undefined; until?: Date | undefined } = {};

    const tier2 = await findTier2FromNewsData(word.wordEn);
    if (tier2.example) return { resolved: tier2.example };
    deferred = mergeDeferred(deferred, { reason: tier2.deferredReason, until: tier2.deferredUntil });

    const tier3 = await findTier3FromGdelt(word.wordEn, 'uzbekistan');
    if (tier3.example) return { resolved: tier3.example };
    deferred = mergeDeferred(deferred, { reason: tier3.deferredReason, until: tier3.deferredUntil });

    // Avoid self-rate-limiting: the second scope should reuse the permit from the same resolve cycle.
    const gdeltBlockedNow = /(gdelt_rate_limited|gdelt_cooldown)/i.test(tier3.deferredReason ?? '');
    if (!gdeltBlockedNow) {
        const tier4 = await findTier3FromGdelt(word.wordEn, 'international', { skipPermit: true });
        if (tier4.example) return { resolved: tier4.example };
        deferred = mergeDeferred(deferred, { reason: tier4.deferredReason, until: tier4.deferredUntil });
    }

    const tier5 = await findTier4FromGuardian(word.wordEn);
    if (tier5.example) return { resolved: tier5.example };
    deferred = mergeDeferred(deferred, { reason: tier5.deferredReason, until: tier5.deferredUntil });

    return {
        resolved: null,
        deferredReason: deferred.reason,
        deferredUntil: deferred.until,
    };
};

const isQuotaReason = (reason: string): boolean =>
    /quota_exhausted/i.test(reason);

const shouldConsumeAttempt = (reason: string): boolean => {
    if (reason === 'word_not_ready') return false;
    if (reason === 'provider_deferred') return false;
    if (/(rate_limited|cooldown|quota_exhausted|network_error|http_429)/i.test(reason)) return false;
    return true;
};

export const calculateRetryDate = (attempts: number, reason: string): Date => {
    if (reason === 'news_not_found') {
        const steps = readNewsNotFoundRetryStepsMinutes();
        const safeAttempts = Math.max(1, attempts);
        const stepIndex = Math.min(steps.length - 1, safeAttempts - 1);
        const minutes = steps[stepIndex] ?? 60;
        return new Date(Date.now() + minutes * 60_000);
    }

    if (isQuotaReason(reason)) {
        return nextUtcDayStart(new Date());
    }

    const baseMinutes = readNewsRetryBaseMinutes();
    const maxMinutes = readNewsRetryMaxMinutes();
    const attemptLevel = Math.max(1, attempts);
    const multiplier = reason === 'word_not_ready'
        ? 1
        : Math.pow(2, Math.min(6, attemptLevel - 1));
    const minutes = Math.min(maxMinutes, baseMinutes * multiplier);
    return new Date(Date.now() + minutes * 60_000);
};

type MarkFailedOptions = {
    scheduledAt?: Date;
    consumeAttempt?: boolean;
};

const markJobFailed = async (
    jobId: number,
    attempts: number,
    error: string,
    options: MarkFailedOptions = {},
): Promise<void> => {
    const trimmed = error.slice(0, 512);
    const consumeAttempt = options.consumeAttempt ?? shouldConsumeAttempt(trimmed);
    const nextAttempts = consumeAttempt ? attempts : Math.max(0, attempts - 1);
    const scheduledAt = options.scheduledAt ?? calculateRetryDate(nextAttempts, trimmed);

    await prisma.newsResolveJob.update({
        where: { id: jobId },
        data: {
            status: 'FAILED',
            attempts: nextAttempts,
            lockedAt: null,
            lastError: trimmed,
            scheduledAt,
        },
    });
};

const markJobDone = async (jobId: number): Promise<void> => {
    await prisma.newsResolveJob.update({
        where: { id: jobId },
        data: {
            status: 'DONE',
            lockedAt: null,
            lastError: null,
            scheduledAt: new Date(),
        },
    });
};

export const isWordReadyForNews = (reviews: Array<{ stage: number }>): boolean =>
    reviews.some((review) => review.stage >= NEWS_STAGE_THRESHOLD);

type QueueWordNewsResolveOptions = {
    forceRequeue?: boolean;
};

export const queueWordNewsResolve = async (
    wordId: number,
    options: QueueWordNewsResolveOptions = {},
): Promise<void> => {
    const word = await prisma.word.findUnique({ where: { id: wordId }, select: { id: true } });
    if (!word) return;
    const forceRequeue = options.forceRequeue === true;

    await prisma.$transaction(async (tx) => {
        await tx.word.update({
            where: { id: wordId },
            data: { newsExampleNeedsRefresh: true },
        });

        const inserted = await tx.$executeRaw`
            INSERT INTO "NewsResolveJob" (
                "wordId",
                status,
                attempts,
                "scheduledAt",
                "createdAt",
                "updatedAt"
            )
            VALUES (
                ${wordId},
                'PENDING'::"NewsResolveJobStatus",
                0,
                NOW(),
                NOW(),
                NOW()
            )
            ON CONFLICT ("wordId") DO NOTHING
        `;

        if (inserted > 0) {
            return;
        }

        await tx.newsResolveJob.updateMany({
            where: forceRequeue
                ? { wordId }
                : { wordId, status: 'DONE' },
            data: {
                status: 'PENDING',
                attempts: 0,
                scheduledAt: new Date(),
                lockedAt: null,
                lastError: null,
            },
        });
    });
};

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

        await prisma.$transaction([
            prisma.word.update({
                where: { id: word.id },
                data: {
                    newsExampleSourceUrl: null,
                    newsExampleNeedsRefresh: true,
                },
            }),
            prisma.newsResolveJob.upsert({
                where: { wordId: word.id },
                create: {
                    wordId: word.id,
                    status: 'PENDING',
                    attempts: 0,
                    scheduledAt: new Date(),
                },
                update: {
                    status: 'PENDING',
                    attempts: 0,
                    lockedAt: null,
                    lastError: 'source_url_broken',
                    scheduledAt: new Date(),
                },
            }),
        ]);

        marked += 1;
    }

    return marked;
};

type ClaimedJobRow = {
    id: number;
    wordId: number;
    attempts: number;
};

export const resolvePendingNewsExamples = async (
    limit = DEFAULT_RESOLVE_BATCH,
): Promise<ResolvePendingNewsExamplesResult> => {
    const startedAt = Date.now();
    const maxJobs = Math.max(1, limit);
    const maxAttempts = readNewsMaxJobAttempts();
    const processingLockTimeoutMinutes = Math.max(1, readNewsRetryBaseMinutes());

    const claimedJobs = await prisma.$queryRaw<ClaimedJobRow[]>`
        WITH claimed AS (
            SELECT id
            FROM "NewsResolveJob"
            WHERE (
                status IN ('PENDING', 'FAILED')
                OR (
                    status = 'PROCESSING'
                    AND (
                        "lockedAt" IS NULL
                        OR "lockedAt" <= (TIMEZONE('UTC', NOW()) - (${processingLockTimeoutMinutes} * INTERVAL '1 minute'))
                    )
                )
            )
              AND "scheduledAt" <= NOW()
              AND attempts < ${maxAttempts}
            ORDER BY "scheduledAt" ASC, id ASC
            LIMIT ${maxJobs}
            FOR UPDATE SKIP LOCKED
        )
        UPDATE "NewsResolveJob" j
        SET status = 'PROCESSING',
            "lockedAt" = NOW(),
            attempts = j.attempts + 1
        FROM claimed
        WHERE j.id = claimed.id
        RETURNING j.id, j."wordId", j.attempts
    `;

    const result: ResolvePendingNewsExamplesResult = {
        claimed: claimedJobs.length,
        resolved: 0,
        failed: 0,
        deferred: 0,
        durationMs: 0,
    };

    for (const jobInfo of claimedJobs) {
        const job = await prisma.newsResolveJob.findUnique({
            where: { id: jobInfo.id },
            include: {
                word: {
                    include: {
                        reviews: {
                            select: { stage: true },
                        },
                    },
                },
            },
        });

        if (!job?.word) {
            await prisma.newsResolveJob.deleteMany({ where: { id: jobInfo.id } });
            result.failed += 1;
            continue;
        }

        if (!isWordReadyForNews(job.word.reviews)) {
            const nextAttempts = Math.max(0, job.attempts - 1);
            await prisma.newsResolveJob.update({
                where: { id: jobInfo.id },
                data: {
                    status: 'PENDING',
                    attempts: nextAttempts,
                    lockedAt: null,
                    scheduledAt: calculateRetryDate(nextAttempts, 'word_not_ready'),
                    lastError: 'word_not_ready',
                },
            });
            result.deferred += 1;
            continue;
        }

        try {
            const outcome = await resolveWordNewsExample(job.word);
            if (!outcome.resolved) {
                const reason = outcome.deferredReason ?? (outcome.deferredUntil ? 'provider_deferred' : 'news_not_found');
                await markJobFailed(jobInfo.id, job.attempts, reason, {
                    ...(outcome.deferredUntil ? { scheduledAt: outcome.deferredUntil } : {}),
                    consumeAttempt: reason === 'news_not_found',
                });
                result.deferred += 1;
                continue;
            }

            await prisma.word.update({
                where: { id: job.wordId },
                data: {
                    newsExampleText: outcome.resolved.text,
                    newsExampleTier: outcome.resolved.tier,
                    newsExampleSourceUrl: outcome.resolved.sourceUrl,
                    newsExampleSourceTitle: outcome.resolved.sourceTitle,
                    newsExamplePreparedAt: new Date(),
                    newsExampleMatchedWord: outcome.resolved.matchedWord,
                    newsExampleNeedsRefresh: false,
                },
            });

            await markJobDone(jobInfo.id);
            result.resolved += 1;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'resolve_failed';
            await markJobFailed(jobInfo.id, job.attempts, message, { consumeAttempt: true });
            result.failed += 1;
        }
    }

    result.durationMs = Date.now() - startedAt;
    return result;
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
