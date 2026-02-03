import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
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

const userId = BigInt(900000002);

beforeAll(async () => {
  const testUrl = await prepareTestDatabase();
  process.env.DATABASE_URL = testUrl;

  const userService = await import('../src/services/userService');
  const reviewService = await import('../src/services/reviewService');
  const { DuplicateWordError } = reviewService;

  ensureUser = userService.ensureUser;
  recordCompletion = userService.recordCompletion;
  resetProgressIfNeeded = userService.resetProgressIfNeeded;

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
  await prisma.$disconnect();
});

describe('service integration', () => {
  it('ensureUser creates default user', async () => {
    const user = await ensureUser(Number(userId));
    expect(user.id.toString()).toBe(userId.toString());
    expect(user.notificationsEnabled).toBe(true);
  });

  it('addWordForUser creates word + review and findDueReview finds it', async () => {
    await ensureUser(Number(userId));
    const { reviewId } = await addWordForUser(userId, 'test', 'тест');
    const review = await loadReviewWithWord(reviewId);
    expect(review?.word?.wordEn).toBe('test');

    await prisma.review.update({
      where: { id: reviewId },
      data: { nextReviewAt: new Date(Date.now() - 1000) },
    });
    const due = await findDueReview(userId);
    expect(due?.word?.wordEn).toBe('test');
    expect(due?.word?.wordEn).toBe('test');
  });

  it('addWordForUser throws DuplicateWordError if word exists', async () => {
    await ensureUser(Number(userId));
    await addWordForUser(userId, 'duplicate', 'дубликат');
    const { DuplicateWordError } = await import('../src/services/reviewService');
    await expect(addWordForUser(userId, 'duplicate', 'дубликат')).rejects.toThrow(DuplicateWordError);
  });

  it('markSkipped resets stage and sets lastResult', async () => {
    await ensureUser(Number(userId));
    const { reviewId } = await addWordForUser(userId, 'skip', 'пропуск');
    const review = await prisma.review.findUnique({ where: { id: reviewId } });
    const updated = await markSkipped(review!);
    expect(updated.stage).toBe(0);
    expect(updated.intervalMinutes).toBe(60);
    expect(updated.lastResult).toBe('SKIPPED');
  });

  it('applyRating updates review result and interval', async () => {
    await ensureUser(Number(userId));
    const { reviewId } = await addWordForUser(userId, 'rate', 'оценка');
    const review = await prisma.review.findUnique({ where: { id: reviewId } });
    const updated = await applyRating(review!, 'GOOD', 'CORRECT', 'EN_TO_RU', 'ответ');
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
});
