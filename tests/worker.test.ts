import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../src/generated/prisma';
import { prepareTestDatabase } from './helpers/testDb';
import { cleanupUserData } from './helpers/cleanup';

let prisma: PrismaClient;
let processUser: (user: any) => Promise<void>;
let tick: () => Promise<void>;
let startWorker: () => void;
let telegram: any;

const userId = BigInt(900000004);

beforeAll(async () => {
  process.env.BOT_TOKEN = process.env.BOT_TOKEN ?? 'test_bot_token';

  const testUrl = await prepareTestDatabase();
  process.env.DATABASE_URL = testUrl;

  vi.resetModules();
  const mod = await import('../src/scheduler/worker');
  processUser = mod.processUser;
  tick = mod.tick;
  startWorker = mod.startWorker;
  telegram = mod.telegram;

  prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
});

beforeEach(async () => {
  await cleanupUserData(prisma, userId);
  vi.restoreAllMocks();
});

afterAll(async () => {
  await cleanupUserData(prisma, userId);
  await prisma?.$disconnect();
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

  it('does not send outside quiet hours', async () => {
    vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);
    const now = new Date();
    const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const quietStart = (currentMinutes + 1) % 1440;
    const quietEnd = (currentMinutes + 2) % 1440;

    await prisma.user.create({
      data: {
        id: userId,
        notificationsEnabled: true,
        quietHoursStartMinutes: quietStart,
        quietHoursEndMinutes: quietEnd,
        timezone: 'UTC',
        notificationIntervalMinutes: 5,
        maxNotificationsPerDay: 100,
      },
    });
    await prisma.word.create({
      data: {
        userId,
        wordEn: 'night',
        translationRu: 'РЅРѕС‡СЊ',
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

    expect(telegram.sendMessage).not.toHaveBeenCalled();
    const session = await prisma.userSession.findUnique({ where: { userId } });
    expect(session?.state).toBe('IDLE');
  });

  it('does not send if notification limit reached', async () => {
    vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);

    await prisma.user.create({
      data: {
        id: userId,
        notificationsEnabled: true,
        quietHoursStartMinutes: 0,
        quietHoursEndMinutes: 0,
        timezone: 'UTC',
        notificationIntervalMinutes: 5,
        maxNotificationsPerDay: 1,
        notificationsSentToday: 1,
        notificationsDate: new Date(),
      },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('does not send when user is busy', async () => {
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

    await prisma.userSession.create({
      data: {
        userId,
        state: 'ADDING_WORD_WAIT_EN',
      },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('does not send when notifications are disabled', async () => {
    vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);

    await prisma.user.create({
      data: {
        id: userId,
        notificationsEnabled: false,
        quietHoursStartMinutes: 0,
        quietHoursEndMinutes: 0,
        timezone: 'UTC',
        notificationIntervalMinutes: 5,
        maxNotificationsPerDay: 100,
      },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('does not send when session is WAITING_GRADE', async () => {
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

    await prisma.userSession.create({
      data: {
        userId,
        state: 'WAITING_GRADE',
      },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('does not send when interval since last notification is too short', async () => {
    vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);

    await prisma.user.create({
      data: {
        id: userId,
        notificationsEnabled: true,
        quietHoursStartMinutes: 0,
        quietHoursEndMinutes: 0,
        timezone: 'UTC',
        notificationIntervalMinutes: 60,
        maxNotificationsPerDay: 100,
        lastNotificationAt: new Date(),
      },
    });
    await prisma.word.create({
      data: {
        userId,
        wordEn: 'interval',
        translationRu: 'интервал',
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

    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('logs when there are no due reviews', async () => {
    vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

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

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    expect(logSpy).toHaveBeenCalledWith(`User ${userId.toString()}: No due reviews`);
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('does not send when optimistic lock fails', async () => {
    vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);
    const sessionService = await import('../src/services/sessionService');
    vi.spyOn(sessionService, 'setSessionActiveIfIdle').mockResolvedValue(false);

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
    await prisma.word.create({
      data: {
        userId,
        wordEn: 'lock',
        translationRu: 'лок',
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

    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('reverts state to IDLE when message send fails', async () => {
    vi.spyOn(telegram, 'sendMessage').mockRejectedValue(new Error('telegram down'));

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

    await prisma.word.create({
      data: {
        userId,
        wordEn: 'fail',
        translationRu: 'провал',
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
    expect(session?.state).toBe('IDLE');
  });

  it('does not remind before 5 minutes', async () => {
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
          data: { userId, wordEn: 'soon', translationRu: 'скоро' },
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
        sentAt: new Date(Date.now() - 2 * 60 * 1000),
        reminderStep: 0,
      },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    const session = await prisma.userSession.findUnique({ where: { userId } });
    expect(session?.state).toBe('WAITING_ANSWER');
    expect(session?.reminderStep).toBe(0);
    expect(telegram.sendMessage).not.toHaveBeenCalled();
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

  it('does not send reminder outside quiet hours', async () => {
    vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);
    const now = new Date();
    const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const quietStart = (currentMinutes + 1) % 1440;
    const quietEnd = (currentMinutes + 2) % 1440;

    await prisma.user.create({
      data: {
        id: userId,
        notificationsEnabled: true,
        quietHoursStartMinutes: quietStart,
        quietHoursEndMinutes: quietEnd,
        timezone: 'UTC',
        notificationIntervalMinutes: 5,
        maxNotificationsPerDay: 100,
      },
    });
    const review = await prisma.review.create({
      data: {
        userId,
        wordId: (await prisma.word.create({
          data: { userId, wordEn: 'silent', translationRu: 'С‚РёС…Рѕ' },
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

    const session = await prisma.userSession.findUnique({ where: { userId } });
    expect(session?.state).toBe('WAITING_ANSWER');
    expect(session?.reminderStep).toBe(0);
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('tick catches per-user errors and continues', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dbClient = await import('../src/db/client');
    const findManySpy = vi
      .spyOn(dbClient.prisma.user, 'findMany')
      .mockResolvedValue([{ id: BigInt(987654321), timezone: 'UTC' } as any]);

    await tick();

    expect(findManySpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('startWorker schedules cron and triggers immediate tick', async () => {
    const cron = await import('node-cron');
    const scheduleSpy = vi
      .spyOn(cron.default, 'schedule')
      .mockImplementation(() => ({ stop: () => {} } as any));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const dbClient = await import('../src/db/client');
    vi.spyOn(dbClient.prisma.user, 'findMany').mockResolvedValue([]);

    startWorker();

    expect(logSpy).toHaveBeenCalledWith('Scheduler started.');
    expect(scheduleSpy).toHaveBeenCalledWith('* * * * *', expect.any(Function));
  });
});
