import { describe, expect, it } from 'vitest';
import dayjs from '../src/utils/time';
import { initialReviewSchedule, scheduleNextReview, scheduleSkipped } from '../src/services/reviewScheduler';

describe('reviewScheduler', () => {
  it('creates initial schedule at stage 0', () => {
    const now = dayjs('2024-01-01T00:00:00Z');
    const schedule = initialReviewSchedule(now);
    expect(schedule.stage).toBe(0);
    expect(schedule.intervalMinutes).toBe(5);
  });

  it('hard moves back a stage (min 0)', () => {
    const now = dayjs('2024-01-01T00:00:00Z');
    const schedule = scheduleNextReview({ stage: 0, intervalMinutes: 5 }, 'HARD', now);
    expect(schedule.stage).toBe(0);
    expect(schedule.intervalMinutes).toBe(5);
  });

  it('good moves forward one stage', () => {
    const now = dayjs('2024-01-01T00:00:00Z');
    const schedule = scheduleNextReview({ stage: 0, intervalMinutes: 5 }, 'GOOD', now);
    expect(schedule.stage).toBe(1);
    expect(schedule.intervalMinutes).toBe(25);
  });

  it('easy adds two stages for early stages', () => {
    const now = dayjs('2024-01-01T00:00:00Z');
    const schedule = scheduleNextReview({ stage: 1, intervalMinutes: 25 }, 'EASY', now);
    expect(schedule.stage).toBe(3);
    expect(schedule.intervalMinutes).toBe(1200);
  });

  it('easy adds two stages later', () => {
    const now = dayjs('2024-01-01T00:00:00Z');
    const schedule = scheduleNextReview({ stage: 3, intervalMinutes: 1200 }, 'EASY', now);
    expect(schedule.stage).toBe(5);
    expect(schedule.intervalMinutes).toBe(8640);
  });

  it('skipped resets to stage 0 with 60 minutes', () => {
    const now = dayjs('2024-01-01T00:00:00Z');
    const schedule = scheduleSkipped(now);
    expect(schedule.stage).toBe(0);
    expect(schedule.intervalMinutes).toBe(60);
  });
});
