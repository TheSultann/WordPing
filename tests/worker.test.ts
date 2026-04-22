import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../src/generated/prisma/client';
import { prepareTestDatabase } from './helpers/testDb';
import { cleanupUserData } from './helpers/cleanup';

let prisma: PrismaClient;
let appPrisma: PrismaClient;
let processUser: (user: any) => Promise<void>;
let tick: () => Promise<void>;
let startWorker: () => void;
let fillSentences: () => Promise<void>;
let telegram: any;
let resetBlockedUserCooldown: () => void;
let setBlockedUserCooldownForTest: (userId: bigint | number, untilMs: number) => void;
let getBlockedUserCooldownSizeForTest: () => number;

const userId = BigInt(900000004);

beforeAll(async () => {
  process.env.BOT_TOKEN = process.env.BOT_TOKEN ?? 'test_bot_token';
  process.env.LOG_FORMAT = 'pretty';

  const testUrl = await prepareTestDatabase();
  process.env.DATABASE_URL = testUrl;

  vi.resetModules();
  const mod = await import('../src/scheduler/worker');
  processUser = mod.processUser;
  tick = mod.tick;
  startWorker = mod.startWorker;
  fillSentences = mod.__fillSentencesForTest;
  telegram = mod.telegram;
  resetBlockedUserCooldown = mod.__resetBlockedUserCooldown;
  setBlockedUserCooldownForTest = mod.__setBlockedUserCooldownForTest;
  getBlockedUserCooldownSizeForTest = mod.__getBlockedUserCooldownSizeForTest;
  appPrisma = (await import('../src/db/client')).prisma as PrismaClient;

  prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
});

beforeEach(async () => {
  await cleanupUserData(prisma, userId);
  vi.restoreAllMocks();
  resetBlockedUserCooldown();
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

  it('does not send initial auto review outside quiet hours', async () => {
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

  it('does not send non-initial reviews outside quiet hours', async () => {
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
        wordEn: 'night-followup',
        translationRu: 'ночной повтор',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
            userId,
            stage: 1,
            intervalMinutes: 25,
            nextReviewAt: new Date(Date.now() - 1000),
            lastReviewAt: new Date(Date.now() - 2 * 60 * 1000),
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

  it('prioritizes newly added pending initial review over older stage-zero backlog', async () => {
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);

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

    const olderWord = await prisma.word.create({
      data: {
        userId,
        wordEn: 'older-backlog',
        translationRu: 'старый долг',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
            userId,
            stage: 0,
            intervalMinutes: 5,
            nextReviewAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
      },
    });
    await prisma.word.update({
      where: { id: olderWord.id },
      data: { createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    const freshWord = await prisma.word.create({
      data: {
        userId,
        wordEn: 'fresh-five-minute',
        translationRu: 'свежее слово',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
            userId,
            initialAutoReviewPending: true,
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
    expect(session?.wordId).toBe(freshWord.id);
    expect(sendSpy).toHaveBeenCalled();
  });

  it('sends EN_TO_RU before RU_TO_EN for the same pending initial word', async () => {
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
      },
    });

    const word = await prisma.word.create({
      data: {
        userId,
        wordEn: 'queue-pair',
        translationRu: 'пара очереди',
        reviews: {
          create: [
            {
              direction: 'EN_TO_RU',
              userId,
              initialAutoReviewPending: true,
              stage: 0,
              intervalMinutes: 5,
              nextReviewAt: new Date(Date.now() - 1000),
            },
            {
              direction: 'RU_TO_EN',
              userId,
              initialAutoReviewPending: true,
              stage: 0,
              intervalMinutes: 5,
              nextReviewAt: new Date(Date.now() - 1000),
            },
          ],
        },
      },
      include: { reviews: true },
    });

    const expectedFirstReview = word.reviews.find((review) => review.direction === 'EN_TO_RU');
    expect(expectedFirstReview).toBeTruthy();

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const session = await prisma.userSession.findUnique({ where: { userId } });
    expect(session?.state).toBe('WAITING_ANSWER');
    expect(session?.reviewId).toBe(expectedFirstReview!.id);
    expect(session?.direction).toBe('EN_TO_RU');
  });

  it('does not send initial auto review when daily notification limit is reached', async () => {
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

    await prisma.word.create({
      data: {
        userId,
        wordEn: 'limit-first-exposure',
        translationRu: 'лимит первое',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
            userId,
            initialAutoReviewPending: true,
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

  it('does not send non-initial reviews when daily notification limit is reached', async () => {
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

    await prisma.word.create({
      data: {
        userId,
        wordEn: 'limit-followup',
        translationRu: 'лимит повтор',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
            userId,
            stage: 1,
            intervalMinutes: 25,
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

  it('resets stale add flow session after 30 minutes and sends the due card', async () => {
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
        wordEn: 'stale-busy',
        translationRu: 'зависшая сессия',
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

    await prisma.userSession.create({
      data: {
        userId,
        state: 'ADDING_WORD_WAIT_EN',
        updatedAt: new Date(Date.now() - 31 * 60 * 1000),
      },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    const session = await prisma.userSession.findUnique({ where: { userId } });
    expect(session?.state).toBe('WAITING_ANSWER');
    expect(session?.wordId).toBe(word.id);
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

  it('does not send when session is QUIZ_ACTIVE', async () => {
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

    await prisma.word.create({
      data: {
        userId,
        wordEn: 'quiz-pause',
        translationRu: 'quiz-pause-native',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
            userId,
            stage: 3,
            intervalMinutes: 30,
            nextReviewAt: new Date(Date.now() - 1000),
          },
        },
      },
    });

    await prisma.userSession.create({
      data: {
        userId,
        state: 'QUIZ_ACTIVE',
      },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('requeues WAITING_GRADE after 20 minutes without changing stage', async () => {
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
        wordEn: 'graded-correct',
        translationRu: 'РїСЂРѕРІРµСЂРєР°',
      },
    });

    const review = await prisma.review.create({
      data: {
        userId,
        wordId: word.id,
        direction: 'EN_TO_RU',
        stage: 2,
        intervalMinutes: 120,
        nextReviewAt: new Date(Date.now() - 1000),
      },
    });

    await prisma.userSession.create({
      data: {
        userId,
        state: 'WAITING_GRADE',
        reviewId: review.id,
        wordId: word.id,
        direction: 'EN_TO_RU',
        sentAt: new Date(Date.now() - 25 * 60 * 1000),
        answerText: 'РїСЂРѕРІРµСЂРєР°',
        payload: { correct: true },
      },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    const session = await prisma.userSession.findUnique({ where: { userId } });
    expect(session?.state).toBe('IDLE');

    const updatedReview = await prisma.review.findUnique({ where: { id: review.id } });
    expect(updatedReview?.lastResult).toBeNull();
    expect(updatedReview?.stage).toBe(2);
    expect(updatedReview?.intervalMinutes).toBe(60);

    const updatedUser = await prisma.user.findUnique({ where: { id: userId } });
    expect(updatedUser?.doneTodayCount).toBe(0);
    expect(updatedUser?.correctTodayCount).toBe(0);
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('requeues WAITING_GRADE after 20 minutes without auto-rating incorrect answers', async () => {
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
        wordEn: 'graded-incorrect',
        translationRu: 'РѕС€РёР±РєР°',
      },
    });

    const review = await prisma.review.create({
      data: {
        userId,
        wordId: word.id,
        direction: 'EN_TO_RU',
        stage: 2,
        intervalMinutes: 120,
        nextReviewAt: new Date(Date.now() - 1000),
      },
    });

    await prisma.userSession.create({
      data: {
        userId,
        state: 'WAITING_GRADE',
        reviewId: review.id,
        wordId: word.id,
        direction: 'EN_TO_RU',
        sentAt: new Date(Date.now() - 25 * 60 * 1000),
        answerText: 'РЅРµ РІРµСЂРЅРѕ',
        payload: { correct: false },
      },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    const session = await prisma.userSession.findUnique({ where: { userId } });
    expect(session?.state).toBe('IDLE');

    const updatedReview = await prisma.review.findUnique({ where: { id: review.id } });
    expect(updatedReview?.lastResult).toBeNull();
    expect(updatedReview?.stage).toBe(2);
    expect(updatedReview?.intervalMinutes).toBe(60);

    const updatedUser = await prisma.user.findUnique({ where: { id: userId } });
    expect(updatedUser?.doneTodayCount).toBe(0);
    expect(updatedUser?.correctTodayCount).toBe(0);
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

  it('uses native-only context for RU_TO_EN cards and hides swap when examples < 3', async () => {
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);

    await prisma.user.create({
      data: {
        id: userId,
        notificationsEnabled: true,
        quietHoursStartMinutes: 0,
        quietHoursEndMinutes: 0,
        timezone: 'UTC',
        language: 'ru',
        notificationIntervalMinutes: 5,
        maxNotificationsPerDay: 100,
      },
    });

    await prisma.word.create({
      data: {
        userId,
        wordEn: 'accept',
        translationRu: 'принимать',
        exampleSentences: [
          { en: 'He will accept the offer.', native: 'Он готов принимать предложение.' },
          { en: 'They accept your terms.', native: 'Они готовы принимать ваши условия.' },
        ] as any,
        reviews: {
          create: {
            direction: 'RU_TO_EN',
            userId,
            stage: 2,
            intervalMinutes: 90,
            nextReviewAt: new Date(Date.now() - 1000),
          },
        },
      },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [, prompt, options] = sendSpy.mock.calls[0] as [number, string, any];
    expect(prompt).toContain('🗣 ');
    expect(prompt).toContain('✍️ → 🇬🇧');
    expect(prompt).not.toContain('RU → EN');
    expect(prompt.indexOf('🗣 ')).toBeLessThan(prompt.indexOf('✍️ → 🇬🇧'));
    expect(prompt).toContain('принимать');
    expect(prompt).not.toContain('accept');
    expect(String(options?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data ?? '')).toContain('hint:');
    expect(options?.reply_markup?.inline_keyboard?.[0]).toHaveLength(1);
  });

  it('shows swap button only when sentence pool has at least 3 items', async () => {
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);

    await prisma.user.create({
      data: {
        id: userId,
        notificationsEnabled: true,
        quietHoursStartMinutes: 0,
        quietHoursEndMinutes: 0,
        timezone: 'UTC',
        language: 'ru',
        notificationIntervalMinutes: 5,
        maxNotificationsPerDay: 100,
      },
    });

    const word = await prisma.word.create({
      data: {
        userId,
        wordEn: 'borrow',
        translationRu: 'занимать',
        exampleSentences: [
          { en: 'I borrow books every week.', native: 'Я беру книги каждую неделю.' },
          { en: 'She can borrow my laptop.', native: 'Она может взять мой ноутбук.' },
          { en: 'We borrow tools from neighbors.', native: 'Мы берём инструменты у соседей.' },
        ] as any,
        reviews: {
          create: {
            direction: 'EN_TO_RU',
            userId,
            stage: 7,
            intervalMinutes: 1200,
            nextReviewAt: new Date(Date.now() - 1000),
          },
        },
      },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [, prompt, options] = sendSpy.mock.calls[0] as [number, string, any];
    expect(prompt).toContain('🗣 ');
    expect(prompt).toContain('✍️ → 🇷🇺');
    expect(prompt).not.toContain('EN → RU');
    expect(prompt).toContain('___');
    expect(String(options?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data ?? '')).toContain('hint:');
    expect(options?.reply_markup?.inline_keyboard?.[0]?.[1]?.callback_data).toContain(`swap:${word.id}:`);
  });

  it('adds hint button and does not auto-show hint text after first hard for RU_TO_EN', async () => {
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);

    await seedHintUser();
    await seedHintReview(1, 'permanent', 'постоянный', 'RU_TO_EN');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [, prompt, options] = sendSpy.mock.calls[0] as [number, string, any];
    expect(prompt).not.toContain('Подсказка💡');
    expect(String(options?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data ?? '')).toContain('hint:');
  });

  it('does not show hint button for words shorter than 4 letters', async () => {
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);

    await seedHintUser();
    await seedHintReview(1, 'go', 'идти', 'RU_TO_EN');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [, prompt, options] = sendSpy.mock.calls[0] as [number, string, any];
    expect(prompt).not.toContain('РџРѕРґСЃРєР°Р·РєР°рџ’Ў');
    expect(options?.reply_markup).toBeUndefined();
  });

  it('does not auto-show hint text after second hard for RU_TO_EN', async () => {
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);

    await seedHintUser();
    await seedHintReview(2, 'permanent', 'постоянный', 'RU_TO_EN');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [, prompt] = sendSpy.mock.calls[0] as [number, string, any];
    expect(prompt).not.toContain('Подсказка💡');
  });

  it('does not auto-show hint text after third hard for RU_TO_EN', async () => {
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);

    await seedHintUser();
    await seedHintReview(3, 'permanent', 'постоянный', 'RU_TO_EN');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [, prompt] = sendSpy.mock.calls[0] as [number, string, any];
    expect(prompt).not.toContain('Подсказка💡');
  });

  it('does not auto-show unicode hint for EN_TO_RU', async () => {
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);

    await seedHintUser();
    await seedHintReview(3);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [, prompt] = sendSpy.mock.calls[0] as [number, string, any];
    expect(prompt).not.toContain('Подсказка💡');
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
            initialAutoReviewPending: true,
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

  it('still sends first-exposure stage 0 when older stage 0 review is interval-limited', async () => {
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
        wordEn: 'old-stage0-reviewed',
        translationRu: 'старая stage0 карточка',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
            userId,
            stage: 0,
            intervalMinutes: 5,
            nextReviewAt: new Date(Date.now() - 10 * 60 * 1000),
            lastReviewAt: new Date(Date.now() - 2 * 60 * 1000),
          },
        },
      },
    });

    const newWord = await prisma.word.create({
      data: {
        userId,
        wordEn: 'new-stage0-first-exposure',
        translationRu: 'новая stage0 карточка',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
            userId,
            initialAutoReviewPending: true,
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

  it('bypasses notification interval for pending initial auto review', async () => {
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
        wordEn: 'limit-stage0',
        translationRu: 'лимитная карточка',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
            userId,
            initialAutoReviewPending: true,
            stage: 0,
            intervalMinutes: 5,
            nextReviewAt: new Date(Date.now() - 1000),
          },
        },
      },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    expect(telegram.sendMessage).toHaveBeenCalled();
    const session = await prisma.userSession.findUnique({ where: { userId } });
    expect(session?.state).toBe('WAITING_ANSWER');
  });

  it('prioritizes newer pending initial review in its own queue', async () => {
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

    await prisma.word.create({
      data: {
        userId,
        wordEn: 'older-stage0',
        translationRu: 'старая карточка',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
            userId,
            initialAutoReviewPending: true,
            stage: 0,
            intervalMinutes: 5,
            nextReviewAt: new Date(Date.now() - 10 * 60 * 1000),
          },
        },
      },
    });

    const newerWord = await prisma.word.create({
      data: {
        userId,
        wordEn: 'newer-stage0',
        translationRu: 'новая карточка',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
            userId,
            initialAutoReviewPending: true,
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
    expect(session?.wordId).toBe(newerWord.id);
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

  it('prioritizes a recently failed fragile review over an older generic due review', async () => {
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);

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
        wordEn: 'archive',
        translationRu: 'архив',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
            userId,
            stage: 6,
            intervalMinutes: 20160,
            nextReviewAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
            lastReviewAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
            lastResult: 'CORRECT',
          },
        },
      },
    });

    const fragileWord = await prisma.word.create({
      data: {
        userId,
        wordEn: 'hesitate',
        translationRu: 'сомневаться',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
            userId,
            stage: 1,
            intervalMinutes: 25,
            nextReviewAt: new Date(Date.now() - 30 * 60 * 1000),
            lastReviewAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
            lastResult: 'INCORRECT',
          },
        },
      },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const session = await prisma.userSession.findUnique({ where: { userId } });
    expect(session?.state).toBe('WAITING_ANSWER');
    expect(session?.wordId).toBe(fragileWord.id);
  });

  it('prioritizes pending initial auto review beyond an older 32-card backlog', async () => {
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);

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

    for (let index = 0; index < 33; index += 1) {
      await prisma.word.create({
        data: {
          userId,
          wordEn: `backlog-initial-${index}`,
          translationRu: `долг начальный ${index}`,
          reviews: {
            create: {
              direction: 'EN_TO_RU',
              userId,
              stage: 6,
              intervalMinutes: 20160,
              nextReviewAt: new Date(Date.now() - (48 * 60 + index) * 60 * 1000),
              lastReviewAt: new Date(Date.now() - 96 * 60 * 60 * 1000),
              lastResult: 'CORRECT',
            },
          },
        },
      });
    }

    const pendingWord = await prisma.word.create({
      data: {
        userId,
        wordEn: 'fresh-initial-priority',
        translationRu: 'свежий первый показ',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
            userId,
            initialAutoReviewPending: true,
            stage: 0,
            intervalMinutes: 5,
            nextReviewAt: new Date(Date.now() - 5 * 60 * 1000),
          },
        },
      },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const session = await prisma.userSession.findUnique({ where: { userId } });
    expect(session?.state).toBe('WAITING_ANSWER');
    expect(session?.wordId).toBe(pendingWord.id);
  });

  it('prioritizes a recently failed review beyond an older 32-card backlog', async () => {
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);

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

    for (let index = 0; index < 33; index += 1) {
      await prisma.word.create({
        data: {
          userId,
          wordEn: `backlog-fragile-${index}`,
          translationRu: `долг хрупкий ${index}`,
          reviews: {
            create: {
              direction: 'EN_TO_RU',
              userId,
              stage: 6,
              intervalMinutes: 20160,
              nextReviewAt: new Date(Date.now() - (72 * 60 + index) * 60 * 1000),
              lastReviewAt: new Date(Date.now() - 96 * 60 * 60 * 1000),
              lastResult: 'CORRECT',
            },
          },
        },
      });
    }

    const fragileWord = await prisma.word.create({
      data: {
        userId,
        wordEn: 'backlog-escape',
        translationRu: 'выбраться из очереди',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
            userId,
            stage: 1,
            intervalMinutes: 25,
            nextReviewAt: new Date(Date.now() - 30 * 60 * 1000),
            lastReviewAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
            lastResult: 'INCORRECT',
          },
        },
      },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const session = await prisma.userSession.findUnique({ where: { userId } });
    expect(session?.state).toBe('WAITING_ANSWER');
    expect(session?.wordId).toBe(fragileWord.id);
  });

  it('tick prioritizes pending initial auto review beyond an older 32-card backlog', async () => {
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);

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

    for (let index = 0; index < 33; index += 1) {
      await prisma.word.create({
        data: {
          userId,
          wordEn: `tick-backlog-initial-${index}`,
          translationRu: `долг tick начальный ${index}`,
          reviews: {
            create: {
              direction: 'EN_TO_RU',
              userId,
              stage: 6,
              intervalMinutes: 20160,
              nextReviewAt: new Date(Date.now() - (48 * 60 + index) * 60 * 1000),
              lastReviewAt: new Date(Date.now() - 96 * 60 * 60 * 1000),
              lastResult: 'CORRECT',
            },
          },
        },
      });
    }

    const pendingWord = await prisma.word.create({
      data: {
        userId,
        wordEn: 'tick-fresh-initial-priority',
        translationRu: 'tick свежий первый показ',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
            userId,
            initialAutoReviewPending: true,
            stage: 0,
            intervalMinutes: 5,
            nextReviewAt: new Date(Date.now() - 5 * 60 * 1000),
          },
        },
      },
    });

    await tick();

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const session = await prisma.userSession.findUnique({ where: { userId } });
    expect(session?.state).toBe('WAITING_ANSWER');
    expect(session?.wordId).toBe(pendingWord.id);
  });

  it('tick prioritizes a recently failed review beyond an older 32-card backlog', async () => {
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);

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

    for (let index = 0; index < 33; index += 1) {
      await prisma.word.create({
        data: {
          userId,
          wordEn: `tick-backlog-fragile-${index}`,
          translationRu: `долг tick хрупкий ${index}`,
          reviews: {
            create: {
              direction: 'EN_TO_RU',
              userId,
              stage: 6,
              intervalMinutes: 20160,
              nextReviewAt: new Date(Date.now() - (72 * 60 + index) * 60 * 1000),
              lastReviewAt: new Date(Date.now() - 96 * 60 * 60 * 1000),
              lastResult: 'CORRECT',
            },
          },
        },
      });
    }

    const fragileWord = await prisma.word.create({
      data: {
        userId,
        wordEn: 'tick-backlog-escape',
        translationRu: 'tick выбраться из очереди',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
            userId,
            stage: 1,
            intervalMinutes: 25,
            nextReviewAt: new Date(Date.now() - 30 * 60 * 1000),
            lastReviewAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
            lastResult: 'INCORRECT',
          },
        },
      },
    });

    await tick();

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const session = await prisma.userSession.findUnique({ where: { userId } });
    expect(session?.state).toBe('WAITING_ANSWER');
    expect(session?.wordId).toBe(fragileWord.id);
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

  it('does not send when quiz claims the session during the idle-to-card race', async () => {
    vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);
    const sessionService = await import('../src/services/sessionService');
    vi.spyOn(sessionService, 'setSessionActiveIfIdle').mockImplementation(async () => {
      await prisma.userSession.upsert({
        where: { userId },
        update: { state: 'QUIZ_ACTIVE' },
        create: { userId, state: 'QUIZ_ACTIVE' },
      });
      return false;
    });

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
        wordEn: 'quiz-race',
        translationRu: 'квиз гонка',
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
    expect(session?.state).toBe('QUIZ_ACTIVE');
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

  it('does not advance sentence index when card delivery fails', async () => {
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

    const word = await prisma.word.create({
      data: {
        userId,
        wordEn: 'steady',
        translationRu: 'стабильный',
        sentenceIndex: 0,
        exampleSentences: [
          { en: 'A steady hand helps.', native: 'Стабильная рука помогает.' },
          { en: 'Keep a steady pace.', native: 'Держи стабильный темп.' },
        ],
        reviews: {
          create: {
            direction: 'EN_TO_RU',
            userId,
            stage: 2,
            intervalMinutes: 90,
            nextReviewAt: new Date(Date.now() - 1000),
          },
        },
      },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    const updatedWord = await prisma.word.findUnique({ where: { id: word.id } });
    expect(updatedWord?.sentenceIndex).toBe(0);

    const session = await prisma.userSession.findUnique({ where: { userId } });
    expect(session?.state).toBe('IDLE');
  });

  it('keeps session active when post-send bookkeeping fails', async () => {
    vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);
    const originalUserUpdate = appPrisma.user.update.bind(appPrisma.user);
    (appPrisma.user as any).update = vi.fn().mockRejectedValueOnce(new Error('counter write failed'));

    try {
      await prisma.user.create({
        data: {
          id: userId,
          notificationsEnabled: true,
          quietHoursStartMinutes: 0,
          quietHoursEndMinutes: 0,
          timezone: 'UTC',
          notificationIntervalMinutes: 5,
          maxNotificationsPerDay: 100,
          notificationsSentToday: 0,
          notificationsDate: new Date(),
        },
      });

      const word = await prisma.word.create({
        data: {
          userId,
          wordEn: 'persist',
          translationRu: 'сохраняться',
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
      expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    } finally {
      (appPrisma.user as any).update = originalUserUpdate;
    }
  });

  it('sets blocked-user cooldown after 403 on card send', async () => {
    const blockedError = {
      response: {
        error_code: 403,
        description: 'Forbidden: bot was blocked by the user',
      },
    };
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockRejectedValue(blockedError as any);

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
        wordEn: 'blocked-card',
        translationRu: 'блок',
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

    let user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    const sessionAfterFirst = await prisma.userSession.findUnique({ where: { userId } });
    expect(sessionAfterFirst?.state).toBe('IDLE');
    expect(sendSpy).toHaveBeenCalledTimes(1);

    // Second tick should be skipped by cooldown (no extra send attempts).
    user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('sets blocked-user cooldown after 403 on reminder send', async () => {
    const blockedError = {
      response: {
        error_code: 403,
        description: 'Forbidden: bot was blocked by the user',
      },
    };
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockRejectedValue(blockedError as any);

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
          data: { userId, wordEn: 'blocked-reminder', translationRu: 'блок-напоминание' },
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

    let user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    const sessionAfterFirst = await prisma.userSession.findUnique({ where: { userId } });
    expect(sessionAfterFirst?.state).toBe('IDLE');
    expect(sendSpy).toHaveBeenCalledTimes(1);

    // Due card exists, but immediate retry should be suppressed by cooldown.
    user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('prunes expired blocked-user cooldown entries during tick', async () => {
    setBlockedUserCooldownForTest(BigInt(111111111), Date.now() - 5_000);
    setBlockedUserCooldownForTest(BigInt(222222222), Date.now() + 60_000);

    expect(getBlockedUserCooldownSizeForTest()).toBe(2);
    await tick();
    expect(getBlockedUserCooldownSizeForTest()).toBe(1);
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

  it('sends reminder after 5 minutes and requeues skipped card without dropping stage', async () => {
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
        stage: 6,
        intervalMinutes: 20160,
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
    expect(updatedReview?.stage).toBe(6);
    expect(updatedReview?.intervalMinutes).toBe(60);
  });

  it('does not overwrite WAITING_GRADE when reminder is delivered during an answer race', async () => {
    const sentAt = new Date(Date.now() - 6 * 60 * 1000);
    await prisma.user.create({
      data: {
        id: userId,
        notificationsEnabled: true,
        quietHoursStartMinutes: 0,
        quietHoursEndMinutes: 0,
        timezone: 'UTC',
        notificationIntervalMinutes: 5,
        maxNotificationsPerDay: 100,
        notificationsDate: new Date(),
      },
    });
    const review = await prisma.review.create({
      data: {
        userId,
        wordId: (await prisma.word.create({
          data: { userId, wordEn: 'race-reminder', translationRu: 'гонка напоминания' },
        })).id,
        direction: 'EN_TO_RU',
        stage: 0,
        intervalMinutes: 5,
        nextReviewAt: new Date(Date.now() - 1000),
      },
    });

    vi.spyOn(telegram, 'sendMessage').mockImplementation(async () => {
      await prisma.userSession.update({
        where: { userId },
        data: {
          state: 'WAITING_GRADE',
          reviewId: review.id,
          wordId: review.wordId,
          direction: 'EN_TO_RU',
          sentAt,
          answerText: 'reply',
          payload: { correct: true },
        },
      });
      return {} as any;
    });

    await prisma.userSession.create({
      data: {
        userId,
        state: 'WAITING_ANSWER',
        reviewId: review.id,
        wordId: review.wordId,
        direction: 'EN_TO_RU',
        sentAt,
        reminderStep: 0,
      },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    const session = await prisma.userSession.findUnique({ where: { userId } });
    expect(session?.state).toBe('WAITING_GRADE');
    expect(session?.answerText).toBe('reply');
  });

  it('preserves payload fields after reminder and counts reminder notification', async () => {
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
          data: { userId, wordEn: 'payload-reminder', translationRu: 'полезная нагрузка' },
        })).id,
        direction: 'EN_TO_RU',
        stage: 7,
        intervalMinutes: 20160,
        nextReviewAt: new Date(Date.now() - 1000),
      },
    });

    await prisma.userSession.create({
      data: {
        userId,
        state: 'WAITING_ANSWER',
        reviewId: review.id,
        wordId: review.wordId,
        direction: 'EN_TO_RU',
        sentAt: new Date(Date.now() - 6 * 60 * 1000),
        reminderStep: 0,
        payload: {
          lang: 'ru',
          cardBaseText: 'base text',
          hintTarget: 'нагрузка',
          hintPresses: 2,
          hintReviewId: review.id,
          swapData: 'swap:1:0',
          hintInline: true,
        },
      },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    const session = await prisma.userSession.findUnique({ where: { userId } });
    expect(session?.state).toBe('WAITING_ANSWER');
    expect(session?.reminderStep).toBe(1);
    expect(session?.payload).toMatchObject({
      lang: 'ru',
      cardBaseText: 'base text',
      hintTarget: 'нагрузка',
      hintPresses: 2,
      hintReviewId: review.id,
      swapData: 'swap:1:0',
      hintInline: true,
    });

    const updatedUser = await prisma.user.findUnique({ where: { id: userId } });
    expect(updatedUser?.notificationsSentToday).toBe(1);
  });

  it('does not send reminder or skip message when daily notification limit is reached', async () => {
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
    const review = await prisma.review.create({
      data: {
        userId,
        wordId: (await prisma.word.create({
          data: { userId, wordEn: 'limit-reminder', translationRu: 'лимит напоминания' },
        })).id,
        direction: 'EN_TO_RU',
        stage: 6,
        intervalMinutes: 20160,
        nextReviewAt: new Date(Date.now() - 1000),
      },
    });

    await prisma.userSession.create({
      data: {
        userId,
        state: 'WAITING_ANSWER',
        reviewId: review.id,
        wordId: review.wordId,
        direction: 'EN_TO_RU',
        sentAt: new Date(Date.now() - 6 * 60 * 1000),
        reminderStep: 0,
      },
    });

    let user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    let session = await prisma.userSession.findUnique({ where: { userId } });
    expect(session?.state).toBe('WAITING_ANSWER');
    expect(session?.reminderStep).toBe(0);
    expect(telegram.sendMessage).not.toHaveBeenCalled();

    await prisma.userSession.update({
      where: { userId },
      data: { sentAt: new Date(Date.now() - 25 * 60 * 1000), reminderStep: 1 },
    });

    user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    session = await prisma.userSession.findUnique({ where: { userId } });
    expect(session?.state).toBe('IDLE');

    const updatedReview = await prisma.review.findUnique({ where: { id: review.id } });
    expect(updatedReview?.lastResult).toBe('SKIPPED');

    const updatedUser = await prisma.user.findUnique({ where: { id: userId } });
    expect(updatedUser?.notificationsSentToday).toBe(1);
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('does not skip a review when the session changes to WAITING_GRADE before timeout claim', async () => {
    const originalUpdateMany = appPrisma.userSession.updateMany.bind(appPrisma.userSession);
    (appPrisma.userSession as any).updateMany = vi.fn(async (args: any) => {
      if (args?.where?.state === 'WAITING_ANSWER' && args?.data?.reviewId === null && !('state' in (args?.data ?? {}))) {
        await prisma.userSession.update({
          where: { userId },
          data: {
            state: 'WAITING_GRADE',
            reviewId: args.where.reviewId,
            wordId: args.where.wordId,
            direction: args.where.direction,
            sentAt: args.where.sentAt,
            answerText: 'late answer',
            payload: { correct: true },
          },
        });
        return { count: 0 } as any;
      }
      return originalUpdateMany(args);
    });

    try {
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
            data: { userId, wordEn: 'late-race', translationRu: 'поздняя гонка' },
          })).id,
          direction: 'EN_TO_RU',
          stage: 6,
          intervalMinutes: 20160,
          nextReviewAt: new Date(Date.now() - 1000),
        },
      });

      const sentAt = new Date(Date.now() - 25 * 60 * 1000);
      await prisma.userSession.create({
        data: {
          userId,
          state: 'WAITING_ANSWER',
          reviewId: review.id,
          wordId: review.wordId,
          direction: 'EN_TO_RU',
          sentAt,
          reminderStep: 1,
        },
      });

      const user = await prisma.user.findUnique({ where: { id: userId } });
      await processUser(user);

      const session = await prisma.userSession.findUnique({ where: { userId } });
      expect(session?.state).toBe('WAITING_GRADE');
      expect(session?.answerText).toBe('late answer');

      const updatedReview = await prisma.review.findUnique({ where: { id: review.id } });
      expect(updatedReview?.lastResult).not.toBe('SKIPPED');
      expect(updatedReview?.intervalMinutes).toBe(20160);
    } finally {
      (appPrisma.userSession as any).updateMany = originalUpdateMany;
    }
  });

  it('keeps WAITING_ANSWER when markSkipped fails during timeout handling', async () => {
    vi.spyOn(telegram, 'sendMessage').mockResolvedValue({} as any);
    const originalReviewUpdate = appPrisma.review.update.bind(appPrisma.review);
    (appPrisma.review as any).update = vi.fn().mockRejectedValueOnce(new Error('skip write failed'));

    try {
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
            data: { userId, wordEn: 'skip-failure', translationRu: 'сбой пропуска' },
          })).id,
          direction: 'EN_TO_RU',
          stage: 6,
          intervalMinutes: 20160,
          nextReviewAt: new Date(Date.now() - 1000),
        },
      });

      await prisma.userSession.create({
        data: {
          userId,
          state: 'WAITING_ANSWER',
          reviewId: review.id,
          wordId: review.wordId,
          direction: 'EN_TO_RU',
          sentAt: new Date(Date.now() - 25 * 60 * 1000),
          reminderStep: 1,
        },
      });

      const user = await prisma.user.findUnique({ where: { id: userId } });
      await processUser(user);

      const session = await prisma.userSession.findUnique({ where: { userId } });
      expect(session?.state).toBe('WAITING_ANSWER');
      expect(session?.reviewId).toBe(review.id);

      const updatedReview = await prisma.review.findUnique({ where: { id: review.id } });
      expect(updatedReview?.lastResult).not.toBe('SKIPPED');
      expect(telegram.sendMessage).not.toHaveBeenCalled();
    } finally {
      (appPrisma.review as any).update = originalReviewUpdate;
    }
  });

  it('counts skip notification when skipped message is sent', async () => {
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
          data: { userId, wordEn: 'skip-counter', translationRu: 'счетчик пропуска' },
        })).id,
        direction: 'EN_TO_RU',
        stage: 6,
        intervalMinutes: 20160,
        nextReviewAt: new Date(Date.now() - 1000),
      },
    });

    await prisma.userSession.create({
      data: {
        userId,
        state: 'WAITING_ANSWER',
        reviewId: review.id,
        wordId: review.wordId,
        direction: 'EN_TO_RU',
        sentAt: new Date(Date.now() - 25 * 60 * 1000),
        reminderStep: 1,
      },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await processUser(user);

    const session = await prisma.userSession.findUnique({ where: { userId } });
    expect(session?.state).toBe('IDLE');

    const updatedUser = await prisma.user.findUnique({ where: { id: userId } });
    expect(updatedUser?.notificationsSentToday).toBe(1);
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
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

  it('fillSentences processes only urgent words during daytime', async () => {
    const sentenceService = await import('../src/services/sentenceService');
    const generateSpy = vi
      .spyOn(sentenceService, 'generateSentences')
      .mockResolvedValue([{ en: 'Fresh urgent sentence.', native: 'Срочный свежий пример.' }]);

    const now = new Date();
    const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const windowStart = (currentMinutes + 1439) % 1440;
    const windowEnd = (currentMinutes + 2) % 1440;

    await prisma.user.create({
      data: {
        id: userId,
        language: 'ru',
        timezone: 'UTC',
        quietHoursStartMinutes: windowStart,
        quietHoursEndMinutes: windowEnd,
      },
    });

    const oldWord = await prisma.word.create({
      data: {
        userId,
        wordEn: 'old-backlog',
        translationRu: 'старый-бэклог',
      },
    });
    await prisma.word.update({
      where: { id: oldWord.id },
      data: { createdAt: new Date(Date.now() - 8 * 60 * 60 * 1000) },
    });

    const urgentWord = await prisma.word.create({
      data: {
        userId,
        wordEn: 'fresh-urgent',
        translationRu: 'свежий-срочный',
      },
    });

    await fillSentences();

    expect(generateSpy).toHaveBeenCalledTimes(1);
    expect(generateSpy.mock.calls[0]?.[0]).toBe('fresh-urgent');

    const oldFresh = await prisma.word.findUnique({ where: { id: oldWord.id } });
    const urgentFresh = await prisma.word.findUnique({ where: { id: urgentWord.id } });
    expect(oldFresh?.exampleSentences).toBeNull();
    expect(Array.isArray(urgentFresh?.exampleSentences as any)).toBe(true);
  });

  it('fillSentences tops up backlog for always-on 24/7 windows', async () => {
    const sentenceService = await import('../src/services/sentenceService');
    const generateSpy = vi
      .spyOn(sentenceService, 'generateSentences')
      .mockResolvedValue([{ en: 'Backlog sentence.', native: 'Пример для бэклога.' }]);

    await prisma.user.create({
      data: {
        id: userId,
        language: 'ru',
        timezone: 'UTC',
        quietHoursStartMinutes: 0,
        quietHoursEndMinutes: 0,
      },
    });

    const partialWord = await prisma.word.create({
      data: {
        userId,
        wordEn: 'always-on-backlog',
        translationRu: 'всегда-онлайн-бэклог',
        exampleSentences: [{ en: 'Existing sentence.', native: 'Существующий пример.' }] as any,
      },
    });
    await prisma.word.update({
      where: { id: partialWord.id },
      data: { createdAt: new Date(Date.now() - 8 * 60 * 60 * 1000) },
    });

    await fillSentences();

    expect(generateSpy).toHaveBeenCalledTimes(1);
    expect(generateSpy.mock.calls[0]?.[0]).toBe('always-on-backlog');

    const refreshed = await prisma.word.findUnique({ where: { id: partialWord.id } });
    expect(Array.isArray(refreshed?.exampleSentences as any)).toBe(true);
    expect((refreshed?.exampleSentences as any[])?.length).toBeGreaterThan(1);
  });

  it('fillSentences prioritizes quiet-hours queue: 0 -> 1-2 -> fresh', async () => {
    const sentenceService = await import('../src/services/sentenceService');
    const seenWords: string[] = [];
    vi.spyOn(sentenceService, 'generateSentences').mockImplementation(async (wordEn) => {
      seenWords.push(wordEn);
      return [{ en: `${wordEn} example`, native: `${wordEn} пример` }];
    });

    const now = new Date();
    const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const windowStart = (currentMinutes + 1) % 1440;
    const windowEnd = (currentMinutes + 2) % 1440;

    await prisma.user.create({
      data: {
        id: userId,
        language: 'ru',
        timezone: 'UTC',
        quietHoursStartMinutes: windowStart,
        quietHoursEndMinutes: windowEnd,
      },
    });

    const zeroWord = await prisma.word.create({
      data: { userId, wordEn: 'queue-zero', translationRu: 'очередь-ноль' },
    });
    await prisma.word.update({
      where: { id: zeroWord.id },
      data: { createdAt: new Date(Date.now() - 9 * 60 * 60 * 1000) },
    });

    const partialWord = await prisma.word.create({
      data: {
        userId,
        wordEn: 'queue-partial',
        translationRu: 'очередь-частично',
        exampleSentences: [{ en: 'queue partial sample', native: 'частичный пример' }] as any,
      },
    });
    await prisma.word.update({
      where: { id: partialWord.id },
      data: { createdAt: new Date(Date.now() - 8 * 60 * 60 * 1000) },
    });

    await prisma.word.create({
      data: {
        userId,
        wordEn: 'queue-fresh',
        translationRu: 'очередь-свежий',
      },
    });

    await fillSentences();

    expect(seenWords).toEqual(['queue-zero', 'queue-partial', 'queue-fresh']);
  });

  it('fillSentences uses dynamic batch size up to 10', async () => {
    const sentenceService = await import('../src/services/sentenceService');
    const generateSpy = vi
      .spyOn(sentenceService, 'generateSentences')
      .mockResolvedValue([{ en: 'batch sentence', native: 'пакетный пример' }]);

    const now = new Date();
    const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const windowStart = (currentMinutes + 1) % 1440;
    const windowEnd = (currentMinutes + 2) % 1440;

    await prisma.user.create({
      data: {
        id: userId,
        language: 'ru',
        timezone: 'UTC',
        quietHoursStartMinutes: windowStart,
        quietHoursEndMinutes: windowEnd,
      },
    });

    for (let i = 0; i < 20; i += 1) {
      const word = await prisma.word.create({
        data: {
          userId,
          wordEn: `batch-word-${i}`,
          translationRu: `батч-${i}`,
        },
      });
      await prisma.word.update({
        where: { id: word.id },
        data: { createdAt: new Date(Date.now() - (10 + i) * 60 * 1000) },
      });
    }

    await fillSentences();

    expect(generateSpy).toHaveBeenCalledTimes(10);
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
