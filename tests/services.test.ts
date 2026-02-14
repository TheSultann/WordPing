import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../src/generated/prisma';
import { prepareTestDatabase } from './helpers/testDb';
import { cleanupUserData } from './helpers/cleanup';

let prisma: PrismaClient;
let ensureUser: (id: number) => Promise<any>;
let addWordForUser: (userId: bigint, wordEn: string, translationRu: string) => Promise<any>;
let findDueReview: (userId: bigint, now?: any) => Promise<any>;
let loadReviewWithWord: (reviewId: number) => Promise<any>;
let applyRating: (...args: any[]) => Promise<any>;
let markSkipped: (review: any) => Promise<any>;
let recordCompletion: (user: any) => Promise<any>;
let resetProgressIfNeeded: (user: any) => Promise<any>;
let setQuietHours: (telegramId: number, startMinutes: number, endMinutes: number) => Promise<any>;
let setNotificationInterval: (telegramId: number, minutes: number) => Promise<any>;
let setNotificationLimit: (telegramId: number, maxPerDay: number) => Promise<any>;
let DailyWordLimitErrorCtor: any;

const userId = BigInt(900000002);

beforeAll(async () => {
  const testUrl = await prepareTestDatabase();
  process.env.DATABASE_URL = testUrl;

  vi.resetModules();
  const userService = await import('../src/services/userService');
  const reviewService = await import('../src/services/reviewService');
  DailyWordLimitErrorCtor = reviewService.DailyWordLimitError;

  ensureUser = userService.ensureUser;
  recordCompletion = userService.recordCompletion;
  resetProgressIfNeeded = userService.resetProgressIfNeeded;
  setQuietHours = userService.setQuietHours;
  setNotificationInterval = userService.setNotificationInterval;
  setNotificationLimit = userService.setNotificationLimit;

  addWordForUser = reviewService.addWordForUser;
  findDueReview = reviewService.findDueReview;
  loadReviewWithWord = reviewService.loadReviewWithWord;
  applyRating = reviewService.applyRating;
  markSkipped = reviewService.markSkipped;

  prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
});

beforeEach(async () => {
  await cleanupUserData(prisma, userId);
});

afterAll(async () => {
  await cleanupUserData(prisma, userId);
  await prisma?.$disconnect();
});

describe('service integration', () => {
  it('ensureUser creates default user', async () => {
    const user = await ensureUser(Number(userId));
    expect(user.id.toString()).toBe(userId.toString());
    expect(user.notificationsEnabled).toBe(true);
  });

  it('addWordForUser creates word + review and findDueReview finds it', async () => {
    await ensureUser(Number(userId));
    const { reviewId } = await addWordForUser(userId, 'test', 'test-ru');
    const review = await loadReviewWithWord(reviewId);
    expect(review?.word?.wordEn).toBe('test');

    await prisma.review.update({
      where: { id: reviewId },
      data: { nextReviewAt: new Date(Date.now() - 1000) },
    });
    const due = await findDueReview(userId);
    expect(due?.word?.wordEn).toBe('test');
  });

  it('addWordForUser throws DuplicateWordError if word exists', async () => {
    await ensureUser(Number(userId));
    await addWordForUser(userId, 'duplicate', 'duplicate-ru');
    const { DuplicateWordError } = await import('../src/services/reviewService');
    await expect(addWordForUser(userId, 'duplicate', 'duplicate-ru')).rejects.toThrow(DuplicateWordError);
  });

  it('addWordForUser enforces daily limit for regular users', async () => {
    await ensureUser(Number(userId));

    const previousAdminIds = process.env.ADMIN_USER_IDS;
    const previousUnlimitedIds = process.env.UNLIMITED_WORD_ADD_IDS;
    try {
      process.env.ADMIN_USER_IDS = '';
      process.env.UNLIMITED_WORD_ADD_IDS = '';

      for (let i = 1; i <= 9; i += 1) {
        await addWordForUser(userId, `limit-${i}`, `limit-ru-${i}`);
      }
      await expect(addWordForUser(userId, 'limit-10', 'limit-ru-10')).rejects.toThrow(DailyWordLimitErrorCtor);
    } finally {
      process.env.ADMIN_USER_IDS = previousAdminIds;
      process.env.UNLIMITED_WORD_ADD_IDS = previousUnlimitedIds;
    }
  });

  it('addWordForUser skips daily limit for unlimited IDs', async () => {
    await ensureUser(Number(userId));

    const previousAdminIds = process.env.ADMIN_USER_IDS;
    const previousUnlimitedIds = process.env.UNLIMITED_WORD_ADD_IDS;
    try {
      process.env.ADMIN_USER_IDS = userId.toString();
      process.env.UNLIMITED_WORD_ADD_IDS = '';

      for (let i = 1; i <= 11; i += 1) {
        await addWordForUser(userId, `free-${i}`, `free-ru-${i}`);
      }
    } finally {
      process.env.ADMIN_USER_IDS = previousAdminIds;
      process.env.UNLIMITED_WORD_ADD_IDS = previousUnlimitedIds;
    }
  });

  it('markSkipped resets stage and sets lastResult', async () => {
    await ensureUser(Number(userId));
    const { reviewId } = await addWordForUser(userId, 'skip', 'skip-ru');
    const review = await prisma.review.findUnique({ where: { id: reviewId } });
    const updated = await markSkipped(review!);
    expect(updated.stage).toBe(0);
    expect(updated.intervalMinutes).toBe(60);
    expect(updated.lastResult).toBe('SKIPPED');
  });

  it('applyRating updates review result and interval', async () => {
    await ensureUser(Number(userId));
    const { reviewId } = await addWordForUser(userId, 'rate', 'rate-ru');
    const review = await prisma.review.findUnique({ where: { id: reviewId } });
    const updated = await applyRating(review!, 'GOOD', 'CORRECT', 'EN_TO_RU', 'answer');
    expect(updated.lastResult).toBe('CORRECT');
    expect(updated.intervalMinutes).toBeGreaterThan(0);
  });

  it('recordCompletion increments streak after 3 completions', async () => {
    await prisma.user.create({ data: { id: userId } });
    const first = await prisma.user.findUnique({ where: { id: userId } });
    const r1 = await recordCompletion(first!);
    expect(r1.goalReached).toBe(false);
    const second = await prisma.user.findUnique({ where: { id: userId } });
    const r2 = await recordCompletion(second!);
    expect(r2.goalReached).toBe(false);
    const third = await prisma.user.findUnique({ where: { id: userId } });
    const r3 = await recordCompletion(third!);
    expect(r3.goalReached).toBe(true);
    const refreshed = await prisma.user.findUnique({ where: { id: userId } });
    expect(refreshed?.streakCount).toBe(1);
    expect(refreshed?.doneTodayCount).toBe(3);
  });

  it('resetProgressIfNeeded resets doneTodayCount on new day', async () => {
    const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await prisma.user.create({
      data: {
        id: userId,
        doneTodayCount: 5,
        lastDoneDate: oldDate,
      },
    });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const updated = await resetProgressIfNeeded(user!);
    expect(updated.doneTodayCount).toBe(0);
  });

  it('setQuietHours enforces minimum span', async () => {
    await ensureUser(Number(userId));
    const updated = await setQuietHours(Number(userId), 600, 650);
    expect(updated.quietHoursStartMinutes).toBe(600);
    expect(updated.quietHoursEndMinutes).toBe(1080);
  });

  it('setNotificationInterval and limit clamp values', async () => {
    await ensureUser(Number(userId));
    const intervalUpdated = await setNotificationInterval(Number(userId), 9999);
    expect(intervalUpdated.notificationIntervalMinutes).toBe(240);

    const limitUpdated = await setNotificationLimit(Number(userId), -5);
    expect(limitUpdated.maxNotificationsPerDay).toBe(5);
  });
});
