import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { CardDirection, DirectionMode, Review, ReviewResult } from '../generated/prisma';
import { prisma } from '../db/client';
import { initialReviewSchedule, Rating, scheduleNextReview, scheduleSkipped } from './reviewScheduler';
import { nowUtc, startOfUserDay } from '../utils/time';

export class DuplicateWordError extends Error {
  constructor(message = 'Duplicate word') {
    super(message);
    this.name = 'DuplicateWordError';
  }
}

const DEFAULT_DAILY_WORD_ADD_LIMIT = 9;

const trimEnv = (value: string | undefined): string => (value ?? '').trim();

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

export const addWordForUser = async (
  userId: bigint,
  wordEn: string,
  translationRu: string
): Promise<AddWordResult> => {
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

  try {
    const created = await prisma.word.create({
      data: {
        userId,
        wordEn: wordEn.trim(),
        translationRu: translationRu.trim(),
        review: {
          create: {
            userId,
            stage: schedule.stage,
            intervalMinutes: schedule.intervalMinutes,
            nextReviewAt: schedule.nextReviewAt,
          },
        },
      },
      select: { id: true, review: { select: { id: true } } },
    });
    return { wordId: created.id, reviewId: created.review?.id || 0 };
  } catch (error) {
    if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new DuplicateWordError();
    }
    throw error;
  }
};

// Always 50/50 regardless of stored mode
export const pickDirection = (_mode: DirectionMode): CardDirection => {
  return Math.random() < 0.5 ? 'RU_TO_EN' : 'EN_TO_RU';
};

export const findDueReview = async (userId: bigint, now = nowUtc()) => {
  return prisma.review.findFirst({
    where: {
      userId,
      nextReviewAt: { lte: now.toDate() },
    },
    orderBy: { nextReviewAt: 'asc' },
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
  return prisma.review.update({
    where: { id: review.id },
    data: {
      stage: schedule.stage,
      intervalMinutes: schedule.intervalMinutes,
      nextReviewAt: schedule.nextReviewAt,
      lastReviewAt: schedule.lastReviewAt,
      lastDirection: direction,
      lastResult: result,
      lastAnswerText: answerText ?? null,
    },
  });
};

export const markSkipped = async (review: Review) => {
  const now = nowUtc();
  const schedule = scheduleSkipped(now);
  return prisma.review.update({
    where: { id: review.id },
    data: {
      stage: schedule.stage,
      intervalMinutes: schedule.intervalMinutes,
      nextReviewAt: schedule.nextReviewAt,
      lastReviewAt: schedule.lastReviewAt,
      lastResult: 'SKIPPED',
    },
  });
};
