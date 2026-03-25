import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import type { CardDirection, Review, ReviewResult } from '../generated/prisma/client';
import { prisma } from '../db/client';
import type { Rating} from './reviewScheduler';
import { initialReviewSchedule, scheduleNextReview, scheduleSkipped, scheduleUnrated } from './reviewScheduler';
import { nowUtc, startOfUserDay } from '../utils/time';
import { trimEnv } from '../utils/env';
import { createLogger } from '../utils/logger';
import { normalizeWordLookup } from '../utils/text';
import { queueWordNewsResolve } from './newsFallbackService';

const reviewLogger = createLogger('review-service');

export class DuplicateWordError extends Error {
  constructor(message = 'Duplicate word') {
    super(message);
    this.name = 'DuplicateWordError';
  }
}

const DEFAULT_DAILY_WORD_ADD_LIMIT = 9;
const CARD_DIRECTIONS: readonly CardDirection[] = ['EN_TO_RU', 'RU_TO_EN'] as const;
const readDailyWordAddLimit = (): number => {
  const raw = Number.parseInt(trimEnv(process.env.DAILY_WORD_ADD_LIMIT), 10);
  if (!Number.isFinite(raw) || raw < 1 || raw > 100) return DEFAULT_DAILY_WORD_ADD_LIMIT;
  return raw;
};

const readUnlimitedWordAddIds = (): Set<string> => {
  const raw = [
    trimEnv(process.env.UNLIMITED_WORD_ADD_IDS),
    trimEnv(process.env.ADMIN_USER_IDS),
    trimEnv(process.env.ADMIN_TELEGRAM_ID),
  ]
    .filter(Boolean)
    .join(',');

  const ids = new Set<string>();
  for (const chunk of raw.split(',')) {
    const id = chunk.trim();
    if (/^\d+$/.test(id)) ids.add(id);
  }
  return ids;
};

const isUnlimitedWordAddUser = (userId: bigint): boolean => {
  return readUnlimitedWordAddIds().has(userId.toString());
};

export class DailyWordLimitError extends Error {
  readonly limit: number;

  constructor(limit: number, message = `Daily word add limit reached (${limit})`) {
    super(message);
    this.name = 'DailyWordLimitError';
    this.limit = limit;
  }
}

export type AddWordResult = {
  wordId: number;
  reviewId: number;
};

type ExistingWordLookup = {
  id: number;
  wordEn: string;
  translationRu: string;
};

export const findExistingWordByNormalizedEn = async (
  userId: bigint,
  wordEn: string
): Promise<ExistingWordLookup | null> => {
  const trimmed = wordEn.trim();
  if (!trimmed) return null;

  const directMatch = await prisma.word.findFirst({
    where: {
      userId,
      wordEn: { equals: trimmed, mode: 'insensitive' },
    },
    select: {
      id: true,
      wordEn: true,
      translationRu: true,
    },
  });
  if (directMatch) return directMatch;

  const normalizedTarget = normalizeWordLookup(trimmed);
  const candidates = await prisma.word.findMany({
    where: { userId },
    select: {
      id: true,
      wordEn: true,
      translationRu: true,
    },
  });

  return candidates.find((candidate) => normalizeWordLookup(candidate.wordEn) === normalizedTarget) ?? null;
};

export const addWordForUser = async (
  userId: bigint,
  wordEn: string,
  translationRu: string
): Promise<AddWordResult> => {
  const existing = await findExistingWordByNormalizedEn(userId, wordEn);
  if (existing) {
    throw new DuplicateWordError();
  }

  const now = nowUtc();
  const schedule = initialReviewSchedule(now);
  const dailyLimit = readDailyWordAddLimit();

  if (!isUnlimitedWordAddUser(userId)) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const dayStart = startOfUserDay(user?.timezone, now);
    const dayEnd = dayStart.add(1, 'day');

    const addedToday = await prisma.word.count({
      where: {
        userId,
        createdAt: {
          gte: dayStart.toDate(),
          lt: dayEnd.toDate(),
        },
      },
    });

    if (addedToday >= dailyLimit) {
      throw new DailyWordLimitError(dailyLimit);
    }
  }

  const existingWordsCount = await prisma.word.count({
    where: { userId },
  });

  try {
    const created = await prisma.$transaction(async (tx) => {
      const word = await tx.word.create({
        data: {
          userId,
          wordEn: wordEn.trim(),
          translationRu: translationRu.trim(),
          reviews: {
            create: CARD_DIRECTIONS.map((direction) => ({
              userId,
              direction,
              stage: schedule.stage,
              intervalMinutes: schedule.intervalMinutes,
              nextReviewAt: schedule.nextReviewAt,
            })),
          },
        },
        select: { id: true, reviews: { select: { id: true, direction: true } } },
      });

      // Referral counts only after the invited user's first successfully added word.
      if (existingWordsCount === 0) {
        await tx.user.updateMany({
          where: {
            id: userId,
            referredById: { not: null },
            referralQualifiedAt: null,
          },
          data: {
            referralQualifiedAt: now.toDate(),
          },
        });
      }

      return word;
    });
    const primaryReviewId =
      created.reviews.find((review) => review.direction === 'EN_TO_RU')?.id ??
      created.reviews[0]?.id ??
      0;
    return { wordId: created.id, reviewId: primaryReviewId };
  } catch (error) {
    if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new DuplicateWordError();
    }
    throw error;
  }
};

export const findDueReview = async (userId: bigint, now = nowUtc()) => {
  return prisma.review.findFirst({
    where: {
      userId,
      nextReviewAt: { lte: now.toDate() },
    },
    orderBy: [{ nextReviewAt: 'asc' }, { id: 'asc' }],
    include: { word: true },
  });
};

export const findDueReviewByStage = async (userId: bigint, stage: number, now = nowUtc()) => {
  return prisma.review.findFirst({
    where: {
      userId,
      stage,
      nextReviewAt: { lte: now.toDate() },
    },
    orderBy: [{ nextReviewAt: 'asc' }, { id: 'asc' }],
    include: { word: true },
  });
};

export const findDueFirstExposureStageZeroReview = async (userId: bigint, now = nowUtc()) => {
  return prisma.review.findFirst({
    where: {
      userId,
      stage: 0,
      lastReviewAt: null,
      nextReviewAt: { lte: now.toDate() },
    },
    orderBy: [{ nextReviewAt: 'asc' }, { id: 'asc' }],
    include: { word: true },
  });
};

/** Find the weakest due word — hardStreak >= minStreak, ordered by worst first. */
export const findWeakDueReview = async (userId: bigint, now = nowUtc(), minStreak = 2) => {
  return prisma.review.findFirst({
    where: {
      userId,
      hardStreak: { gte: minStreak },
      nextReviewAt: { lte: now.toDate() },
    },
    orderBy: [{ hardStreak: 'desc' }, { nextReviewAt: 'asc' }],
    include: { word: true },
  });
};

export const loadReviewWithWord = async (reviewId: number) => {
  return prisma.review.findUnique({ where: { id: reviewId }, include: { word: true } });
};

export const applyRating = async (
  review: Review,
  rating: Rating,
  result: ReviewResult,
  direction: CardDirection,
  answerText?: string
) => {
  const now = nowUtc();
  const schedule = scheduleNextReview(review, rating, now);
  const effectiveDirection = direction === review.direction ? direction : review.direction;
  const prevHardStreak = (review as any).hardStreak ?? 0;
  const hardStreak =
    rating === 'HARD'
      ? prevHardStreak + 1
      : 0;
  const updated = await prisma.review.update({
    where: { id: review.id },
    data: {
      stage: schedule.stage,
      intervalMinutes: schedule.intervalMinutes,
      nextReviewAt: schedule.nextReviewAt,
      lastReviewAt: schedule.lastReviewAt,
      lastDirection: effectiveDirection,
      lastResult: result,
      lastAnswerText: answerText ?? null,
      hardStreak,
    },
  });

  if (review.stage < 4 && updated.stage >= 4) {
    queueWordNewsResolve(review.wordId).catch((error) => {
      reviewLogger.error('failed to queue news resolve job', { wordId: review.wordId, error });
    });
  }

  return updated;
};

export const markSkipped = async (review: Review) => {
  const now = nowUtc();
  const schedule = scheduleSkipped(review, now);
  return prisma.review.update({
    where: { id: review.id },
    data: {
      stage: schedule.stage,
      intervalMinutes: schedule.intervalMinutes,
      nextReviewAt: schedule.nextReviewAt,
      lastReviewAt: schedule.lastReviewAt,
      lastResult: 'SKIPPED',
      hardStreak: 0,
    },
  });
};

export const markPendingGradeExpired = async (
  review: Review,
  direction: CardDirection,
  answerText?: string
) => {
  const now = nowUtc();
  const schedule = scheduleUnrated(review, now);
  const effectiveDirection = direction === review.direction ? direction : review.direction;
  return prisma.review.update({
    where: { id: review.id },
    data: {
      stage: schedule.stage,
      intervalMinutes: schedule.intervalMinutes,
      nextReviewAt: schedule.nextReviewAt,
      lastDirection: effectiveDirection,
      lastAnswerText: answerText ?? review.lastAnswerText ?? null,
    },
  });
};
