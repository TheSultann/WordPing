import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { CardDirection, DirectionMode, Review, ReviewResult } from '../generated/prisma';
import { prisma } from '../db/client';
import { initialReviewSchedule, Rating, scheduleNextReview, scheduleSkipped } from './reviewScheduler';
import { nowUtc } from '../utils/time';

export class DuplicateWordError extends Error {
  constructor(message = 'Duplicate word') {
    super(message);
    this.name = 'DuplicateWordError';
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
