import { prisma } from '../../db/client';
import {
    NEWS_STAGE_THRESHOLD,
    DEFAULT_RESOLVE_BATCH,
    readNewsMaxJobAttempts,
    readNewsNotFoundRetryStepsMinutes,
    readNewsRetryBaseMinutes,
    readNewsRetryMaxMinutes,
} from './config';
import { nextUtcDayStart } from './utils';
import type { ResolveOutcome, ResolvePendingNewsExamplesResult } from './types';
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

type ClaimedJobRow = {
    id: number;
    wordId: number;
    attempts: number;
};

type ClaimedJobProcessingStatus = 'resolved' | 'failed' | 'deferred';

const loadClaimedJob = (jobId: number) =>
    prisma.newsResolveJob.findUnique({
        where: { id: jobId },
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

const requeueWordNotReadyJob = async (jobId: number, attempts: number): Promise<void> => {
    const nextAttempts = Math.max(0, attempts - 1);
    await prisma.newsResolveJob.update({
        where: { id: jobId },
        data: {
            status: 'PENDING',
            attempts: nextAttempts,
            lockedAt: null,
            scheduledAt: calculateRetryDate(nextAttempts, 'word_not_ready'),
            lastError: 'word_not_ready',
        },
    });
};

const persistResolvedNewsExample = async (
    jobId: number,
    wordId: number,
    resolved: NonNullable<ResolveOutcome['resolved']>,
): Promise<void> => {
    await prisma.word.update({
        where: { id: wordId },
        data: {
            newsExampleText: resolved.text,
            newsExampleTier: resolved.tier,
            newsExampleSourceUrl: resolved.sourceUrl,
            newsExampleSourceTitle: resolved.sourceTitle,
            newsExamplePreparedAt: new Date(),
            newsExampleMatchedWord: resolved.matchedWord,
            newsExampleNeedsRefresh: false,
        },
    });

    await markJobDone(jobId);
};

const processClaimedJob = async (jobInfo: ClaimedJobRow): Promise<ClaimedJobProcessingStatus> => {
    const job = await loadClaimedJob(jobInfo.id);

    if (!job?.word) {
        await prisma.newsResolveJob.deleteMany({ where: { id: jobInfo.id } });
        return 'failed';
    }

    if (!isWordReadyForNews(job.word.reviews)) {
        await requeueWordNotReadyJob(jobInfo.id, job.attempts);
        return 'deferred';
    }

    try {
        const outcome = await resolveWordNewsExample(job.word);
        if (!outcome.resolved) {
            const reason = outcome.deferredReason ?? (outcome.deferredUntil ? 'provider_deferred' : 'news_not_found');
            await markJobFailed(jobInfo.id, job.attempts, reason, {
                ...(outcome.deferredUntil ? { scheduledAt: outcome.deferredUntil } : {}),
                consumeAttempt: reason === 'news_not_found',
            });
            return 'deferred';
        }

        await persistResolvedNewsExample(jobInfo.id, job.wordId, outcome.resolved);
        return 'resolved';
    } catch (error) {
        const message = error instanceof Error ? error.message : 'resolve_failed';
        await markJobFailed(jobInfo.id, job.attempts, message, { consumeAttempt: true });
        return 'failed';
    }
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
        const status = await processClaimedJob(jobInfo);
        result[status] += 1;
    }

    result.durationMs = Date.now() - startedAt;
    return result;
};
