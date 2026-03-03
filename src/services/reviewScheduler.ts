import dayjs, { Dayjs } from 'dayjs';
import { Review } from '../generated/prisma/client';
import { addMinutes } from '../utils/time';

export type Rating = 'HARD' | 'GOOD' | 'EASY';

// Fixed ladder of intervals per stage (minutes)
// 5m, 25m, 1.5h, 20h, 2.5d, 6d, 14d, 30d
const STAGE_INTERVALS = [5, 25, 90, 1200, 3600, 8640, 20160, 43200] as const;
type StageInterval = (typeof STAGE_INTERVALS)[number];
const MAX_STAGE = STAGE_INTERVALS.length - 1;

const intervalForStage = (stage: number): StageInterval => {
  const clamped = Math.min(Math.max(stage, 0), MAX_STAGE);
  return STAGE_INTERVALS[clamped]!;
};

export const initialReviewSchedule = (now: Dayjs) => {
  const stage = 0;
  const intervalMinutes = intervalForStage(stage);
  return {
    stage,
    intervalMinutes,
    nextReviewAt: addMinutes(now, intervalMinutes).toDate(),
  };
};

const nextByRating = (review: Pick<Review, 'stage'>, rating: Rating) => {
  const stage = review.stage ?? 0;

  if (rating === 'HARD') {
    const targetStage = Math.max(0, stage - 1);
    return { stage: targetStage, intervalMinutes: intervalForStage(targetStage) };
  }

  if (rating === 'GOOD') {
    const targetStage = Math.min(stage + 1, MAX_STAGE);
    return { stage: targetStage, intervalMinutes: intervalForStage(targetStage) };
  }

  // EASY: strict +2 stage jump (capped by max stage)
  const targetStage = Math.min(stage + 2, MAX_STAGE);
  return { stage: targetStage, intervalMinutes: intervalForStage(targetStage) };
};

export const scheduleNextReview = (review: Pick<Review, 'stage' | 'intervalMinutes'>, rating: Rating, now: Dayjs) => {
  const { stage, intervalMinutes } = nextByRating(review, rating);
  return {
    stage,
    intervalMinutes,
    nextReviewAt: addMinutes(now, intervalMinutes).toDate(),
    lastReviewAt: now.toDate(),
  };
};

export const scheduleSkipped = (now: Dayjs) => {
  const intervalMinutes = 60; // still bring back soon if user skipped
  return {
    stage: 0,
    intervalMinutes,
    nextReviewAt: addMinutes(now, intervalMinutes).toDate(),
    lastReviewAt: now.toDate(),
  };
};

