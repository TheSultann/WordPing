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
let countReferrals: (telegramId: bigint | number) => Promise<number>;
let DailyWordLimitErrorCtor: any;

const userId = BigInt(900000002);
const referrerId = BigInt(900000003);
const invitedId = BigInt(900000004);

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
  countReferrals = userService.countReferrals;

  addWordForUser = reviewService.addWordForUser;
  findDueReview = reviewService.findDueReview;
  loadReviewWithWord = reviewService.loadReviewWithWord;
  applyRating = reviewService.applyRating;
  markSkipped = reviewService.markSkipped;

  prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
});

beforeEach(async () => {
  await cleanupUserData(prisma, userId);
  await cleanupUserData(prisma, invitedId);
  await cleanupUserData(prisma, referrerId);
});

afterAll(async () => {
  await cleanupUserData(prisma, userId);
  await cleanupUserData(prisma, invitedId);
  await cleanupUserData(prisma, referrerId);
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

  it('addWordForUser creates independent reviews for both directions', async () => {
    await ensureUser(Number(userId));
    const { wordId } = await addWordForUser(userId, 'dual', 'dual-ru');
    const reviews = await prisma.review.findMany({
      where: { wordId },
      orderBy: { direction: 'asc' },
      select: { direction: true, stage: true, intervalMinutes: true },
    });

    expect(reviews).toHaveLength(2);
    expect(reviews.map((review) => review.direction).sort()).toEqual(['EN_TO_RU', 'RU_TO_EN']);
    expect(reviews.every((review) => review.stage === 0)).toBe(true);
    expect(reviews.every((review) => review.intervalMinutes === 5)).toBe(true);
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

  it('applyRating updates only current direction review', async () => {
    await ensureUser(Number(userId));
    const { wordId } = await addWordForUser(userId, 'pair', 'пара');
    const reviews = await prisma.review.findMany({
      where: { wordId },
      select: { id: true, direction: true, stage: true, intervalMinutes: true },
    });

    const enToRu = reviews.find((review) => review.direction === 'EN_TO_RU');
    const ruToEn = reviews.find((review) => review.direction === 'RU_TO_EN');
    expect(enToRu).toBeTruthy();
    expect(ruToEn).toBeTruthy();

    const enToRuReview = await prisma.review.findUnique({ where: { id: enToRu!.id } });
    const beforeRuToEn = await prisma.review.findUnique({ where: { id: ruToEn!.id } });
    const updated = await applyRating(enToRuReview!, 'EASY', 'CORRECT', 'EN_TO_RU', 'pair');
    const afterRuToEn = await prisma.review.findUnique({ where: { id: ruToEn!.id } });

    expect(updated.id).toBe(enToRu!.id);
    expect(updated.stage).toBeGreaterThan(enToRu!.stage);
    expect(afterRuToEn?.stage).toBe(beforeRuToEn?.stage);
    expect(afterRuToEn?.intervalMinutes).toBe(beforeRuToEn?.intervalMinutes);
  });

  it('applyRating enqueues news resolve job when stage crosses 4+', async () => {
    await ensureUser(Number(userId));
    const { wordId } = await addWordForUser(userId, 'headline', 'заголовок');
    const review = await prisma.review.findFirst({
      where: { wordId, direction: 'EN_TO_RU' },
    });
    expect(review).toBeTruthy();

    const first = await applyRating(review!, 'EASY', 'CORRECT', 'EN_TO_RU', 'headline');
    expect(first.stage).toBe(2);

    const second = await applyRating(first, 'EASY', 'CORRECT', 'EN_TO_RU', 'headline');
    expect(second.stage).toBe(4);

    await new Promise((resolve) => setTimeout(resolve, 30));
    const job = await prisma.newsResolveJob.findUnique({ where: { wordId } });
    expect(job?.status).toBe('PENDING');
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

  it('counts referral only after invited user adds first word', async () => {
    await prisma.user.create({ data: { id: referrerId } });
    await prisma.user.create({
      data: {
        id: invitedId,
        referredById: referrerId,
      },
    });

    expect(await countReferrals(referrerId)).toBe(0);

    await addWordForUser(invitedId, 'qualified', 'qualified-ru');

    expect(await countReferrals(referrerId)).toBe(1);
    const invited = await prisma.user.findUnique({
      where: { id: invitedId },
      select: { referralQualifiedAt: true },
    });
    expect(invited?.referralQualifiedAt).toBeTruthy();
  });
});
