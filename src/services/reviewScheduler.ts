import dayjs, { Dayjs } from 'dayjs';
import { Review } from '../generated/prisma';
import { addMinutes } from '../utils/time';

export type Rating = 'HARD' | 'GOOD' | 'EASY';

// Fixed ladder of intervals per stage (minutes)
const STAGE_INTERVALS = [5, 25, 120, 1440, 4320, 10080, 23040, 50400] as const;
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

  // EASY
  const jumpStage = stage <= 2 ? 4 : stage + 2;
  const targetStage = Math.min(jumpStage, MAX_STAGE);
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
