import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../src/generated/prisma';
import { prepareTestDatabase } from './helpers/testDb';
import { cleanupUserData } from './helpers/cleanup';

let prisma: PrismaClient;
let processUser: (user: any) => Promise<void>;
let telegram: any;

const userId = BigInt(900000004);

beforeAll(async () => {
  process.env.BOT_TOKEN = process.env.BOT_TOKEN ?? 'test_bot_token';

  const testUrl = await prepareTestDatabase();
  process.env.DATABASE_URL = testUrl;

  const mod = await import('../src/scheduler/worker');
  processUser = mod.processUser;
  telegram = mod.telegram;

  prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
});

beforeEach(async () => {
  await cleanupUserData(prisma, userId);
  vi.restoreAllMocks();
});

afterAll(async () => {
  await cleanupUserData(prisma, userId);
  await prisma.$disconnect();
});

describe('worker integration', () => {
  it('sends a due card and updates session + counters', async () => {
    vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);

    await prisma.user.create({
      data: {
        id: userId,
        notificationsEnabled: true,
        quietHoursStartMinutes: 0,
        quietHoursEndMinutes: 0,
        timezone: 'UTC',
        notificationIntervalMinutes: 5,
        maxNotificationsPerDay: 100,
      },
    });
    const word = await prisma.word.create({
      data: {
        userId,
        wordEn: 'hello',
        translationRu: 'привет',
        review: {
          create: {
            userId,
            stage: 0,
            intervalMinutes: 5,
            nextReviewAt: new Date(Date.now() - 1000),
          },
        },
      },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    const session = await prisma.userSession.findUnique({ where: { userId } });
    expect(session?.state).toBe('WAITING_ANSWER');
    expect(session?.wordId).toBe(word.id);

    const updatedUser = await prisma.user.findUnique({ where: { id: userId } });
    expect(updatedUser?.notificationsSentToday).toBeGreaterThan(0);

    expect(telegram.sendMessage).toHaveBeenCalled();
  });

  it('sends reminder after 5 minutes and skips after 20 minutes', async () => {
    vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);

    await prisma.user.create({
      data: {
        id: userId,
        notificationsEnabled: true,
        quietHoursStartMinutes: 0,
        quietHoursEndMinutes: 0,
        timezone: 'UTC',
        notificationIntervalMinutes: 5,
        maxNotificationsPerDay: 100,
      },
    });
    const review = await prisma.review.create({
      data: {
        userId,
        wordId: (await prisma.word.create({
          data: { userId, wordEn: 'rem', translationRu: 'напоминание' },
        })).id,
        stage: 0,
        intervalMinutes: 5,
        nextReviewAt: new Date(Date.now() - 1000),
      },
    });

    await prisma.userSession.create({
      data: {
        userId,
        state: 'WAITING_ANSWER',
        reviewId: review.id,
        wordId: review.wordId,
        sentAt: new Date(Date.now() - 6 * 60 * 1000),
        reminderStep: 0,
      },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    let session = await prisma.userSession.findUnique({ where: { userId } });
    expect(session?.reminderStep).toBe(1);

    await prisma.userSession.update({
      where: { userId },
      data: { sentAt: new Date(Date.now() - 25 * 60 * 1000), reminderStep: 1 },
    });

    const user2 = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user2);

    session = await prisma.userSession.findUnique({ where: { userId } });
    expect(session?.state).toBe('IDLE');

    const updatedReview = await prisma.review.findUnique({ where: { id: review.id } });
    expect(updatedReview?.lastResult).toBe('SKIPPED');
  });
});
