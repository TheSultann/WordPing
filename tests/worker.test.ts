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
  const seedHintUser = async () => {
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
  };

  const seedHintReview = async (
    hardStreak: number,
    wordEn = 'permanent',
    translationRu = 'постоянный',
    direction: 'EN_TO_RU' | 'RU_TO_EN' = 'EN_TO_RU'
  ) => {
    await prisma.word.create({
      data: {
        userId,
        wordEn,
        translationRu,
        reviews: {
          create: {
            direction,
            userId,
            stage: 1,
            hardStreak,
            intervalMinutes: 25,
            nextReviewAt: new Date(Date.now() - 1000),
            lastReviewAt: new Date(Date.now() - 2 * 60 * 1000),
          },
        },
      },
    });
  };

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
        reviews: {
          create: {
            direction: 'EN_TO_RU',
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
        reviews: {
          create: {
            direction: 'EN_TO_RU',
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
        reviews: {
          create: {
            direction: 'EN_TO_RU',
            userId,
            stage: 1,
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

  it('shows first-letter hint after first hard for RU_TO_EN', async () => {
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);

    await seedHintUser();
    await seedHintReview(1, 'permanent', 'постоянный', 'RU_TO_EN');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [, prompt] = sendSpy.mock.calls[0] as [number, string, any];
    expect(prompt).toContain('Подсказка💡: p________');
  });

  it('shows first-and-last-letter hint after second hard for RU_TO_EN', async () => {
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);

    await seedHintUser();
    await seedHintReview(2, 'permanent', 'постоянный', 'RU_TO_EN');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [, prompt] = sendSpy.mock.calls[0] as [number, string, any];
    expect(prompt).toContain('Подсказка💡: p_______t');
  });

  it('shows first-second-and-last-letter hint after third hard for RU_TO_EN', async () => {
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);

    await seedHintUser();
    await seedHintReview(3, 'permanent', 'постоянный', 'RU_TO_EN');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [, prompt] = sendSpy.mock.calls[0] as [number, string, any];
    expect(prompt).toContain('Подсказка💡: pe______t');
  });

  it('builds unicode hint correctly for EN_TO_RU', async () => {
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);

    await seedHintUser();
    await seedHintReview(3);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [, prompt] = sendSpy.mock.calls[0] as [number, string, any];
    expect(prompt).toContain('Подсказка💡: по_______й');
  });

  it('still sends due stage 0 cards when older due cards are interval-limited', async () => {
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
        wordEn: 'old-card',
        translationRu: 'СЃС‚Р°СЂР°СЏ РєР°СЂС‚РѕС‡РєР°',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
            userId,
            stage: 1,
            intervalMinutes: 25,
            nextReviewAt: new Date(Date.now() - 10 * 60 * 1000),
          },
        },
      },
    });

    const newWord = await prisma.word.create({
      data: {
        userId,
        wordEn: 'new-card',
        translationRu: 'РЅРѕРІР°СЏ РєР°СЂС‚РѕС‡РєР°',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
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

    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    const session = await prisma.userSession.findUnique({ where: { userId } });
    expect(session?.state).toBe('WAITING_ANSWER');
    expect(session?.wordId).toBe(newWord.id);
  });

  it('does not bypass daily limit for first stage 0 cards', async () => {
    vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);

    await prisma.user.create({
      data: {
        id: userId,
        notificationsEnabled: true,
        quietHoursStartMinutes: 0,
        quietHoursEndMinutes: 0,
        timezone: 'UTC',
        notificationIntervalMinutes: 60,
        maxNotificationsPerDay: 1,
        notificationsSentToday: 1,
        notificationsDate: new Date(),
        lastNotificationAt: new Date(),
      },
    });

    await prisma.word.create({
      data: {
        userId,
        wordEn: 'limit-stage0',
        translationRu: 'лимитная карточка',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
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

  it('prioritizes oldest due stage 0 card to keep FIFO queue order', async () => {
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);

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

    const olderWord = await prisma.word.create({
      data: {
        userId,
        wordEn: 'older-stage0',
        translationRu: 'старая карточка',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
            userId,
            stage: 0,
            intervalMinutes: 5,
            nextReviewAt: new Date(Date.now() - 10 * 60 * 1000),
          },
        },
      },
    });

    await prisma.word.create({
      data: {
        userId,
        wordEn: 'newer-stage0',
        translationRu: 'новая карточка',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
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

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const session = await prisma.userSession.findUnique({ where: { userId } });
    expect(session?.state).toBe('WAITING_ANSWER');
    expect(session?.wordId).toBe(olderWord.id);
  });

  it('does not bypass interval for stage 0 cards after first review', async () => {
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
        wordEn: 'stage0-reviewed',
        translationRu: 'первая проверка уже была',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
            userId,
            stage: 0,
            intervalMinutes: 5,
            nextReviewAt: new Date(Date.now() - 1000),
            lastReviewAt: new Date(Date.now() - 2 * 60 * 1000),
          },
        },
      },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('does not send when there are no due reviews', async () => {
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

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

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
        reviews: {
          create: {
            direction: 'EN_TO_RU',
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
        reviews: {
          create: {
            direction: 'EN_TO_RU',
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
        direction: 'EN_TO_RU',
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
        direction: 'EN_TO_RU',
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
        direction: 'EN_TO_RU',
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
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
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
      .mockImplementation(() => ({ stop: () => { } } as any));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
    const dbClient = await import('../src/db/client');
    vi.spyOn(dbClient.prisma.user, 'findMany').mockResolvedValue([]);

    startWorker();

    expect(logSpy).toHaveBeenCalledWith('Scheduler started.');
    expect(scheduleSpy).toHaveBeenCalledWith('* * * * *', expect.any(Function));
  });
});
