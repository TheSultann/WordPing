import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../src/generated/prisma';
import { prepareTestDatabase } from './helpers/testDb';
import { cleanupUserData } from './helpers/cleanup';
import { t } from '../src/i18n';

const suggestTranslationMock = vi.fn().mockResolvedValue(null as string | null);

vi.mock('../src/services/translation', () => ({
  suggestTranslation: suggestTranslationMock,
}));

let bot: any;
let prisma: PrismaClient;
let setState: (userId: bigint, state: any, data?: any) => Promise<any>;

const userId = 900000015;
const referrerId = 900000099;

const nowTs = () => Math.floor(Date.now() / 1000);

const makeMessageUpdate = (text: string, messageId = 1) => ({
  update_id: messageId,
  message: {
    message_id: messageId,
    date: nowTs(),
    text,
    entities: text.startsWith('/') ? [{ offset: 0, length: text.split(' ')[0]!.length, type: 'bot_command' }] : undefined,
    chat: { id: userId, type: 'private' },
    from: { id: userId, is_bot: false, first_name: 'Flow' },
  },
});

const makeCallbackUpdate = (data: string, messageId = 1) => ({
  update_id: messageId,
  callback_query: {
    id: `cb-${messageId}`,
    from: { id: userId, is_bot: false, first_name: 'Flow' },
    chat_instance: 'chat-1',
    data,
    message: {
      message_id: messageId,
      date: nowTs(),
      chat: { id: userId, type: 'private' },
      text: 'callback',
    },
  },
});

const sentTexts = (spy: any) =>
  spy.mock.calls
    .filter(([method]: any[]) => method === 'sendMessage')
    .map(([, payload]: any[]) => String(payload?.text ?? ''));

const editedTexts = (spy: any) =>
  spy.mock.calls
    .filter(([method]: any[]) => method === 'editMessageText')
    .map(([, payload]: any[]) => String(payload?.text ?? ''));

beforeAll(async () => {
  process.env.BOT_TOKEN = process.env.BOT_TOKEN ?? 'test_bot_token';
  process.env.WEBAPP_URL = 'https://example.test/app';

  const testUrl = await prepareTestDatabase();
  process.env.DATABASE_URL = testUrl;

  vi.resetModules();
  const botModule = await import('../src/bot/index');
  const sessionService = await import('../src/services/sessionService');

  bot = botModule.bot;
  setState = sessionService.setState;

  prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
});

beforeEach(async () => {
  await cleanupUserData(prisma, BigInt(userId));
  await cleanupUserData(prisma, BigInt(referrerId));
  vi.restoreAllMocks();
  suggestTranslationMock.mockReset();
  suggestTranslationMock.mockResolvedValue(null);
});

afterAll(async () => {
  await cleanupUserData(prisma, BigInt(userId));
  await cleanupUserData(prisma, BigInt(referrerId));
  await prisma?.$disconnect();
});

describe('bot extended flows', () => {
  it('/start with referral sets onboarding state and saves referrer', async () => {
    await prisma.user.create({ data: { id: BigInt(referrerId) } });
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeMessageUpdate(`/start ref_${referrerId}`, 1), {} as any);

    const texts = sentTexts(callApiSpy);
    expect(texts.some((text) => text.includes(t('ru', 'chooseLang')))).toBe(true);
    expect(texts.some((text) => text.includes(t('uz', 'chooseLang')))).toBe(true);

    const createdUser = await prisma.user.findUnique({ where: { id: BigInt(userId) } });
    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(createdUser?.referredById?.toString()).toBe(String(referrerId));
    expect(session?.state).toBe('IDLE');
    expect((session?.payload as any)?.onboarding?.step).toBe('lang');
  });

  it('lang callback persists language and sends hint', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeCallbackUpdate('lang:uz', 2), {} as any);

    const user = await prisma.user.findUnique({ where: { id: BigInt(userId) } });
    expect(user?.language).toBe('uz');

    const answerCb = callApiSpy.mock.calls.find(([method]: any[]) => method === 'answerCallbackQuery');
    expect(answerCb).toBeTruthy();
    expect(sentTexts(callApiSpy)).toContain(t('uz', 'hint'));
  });

  it('onboarding next moves to SETTINGS_WAIT_GOAL', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'uz' } });
    await setState(BigInt(userId), 'IDLE');

    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeCallbackUpdate('onboarding:next', 3), {} as any);

    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(session?.state).toBe('SETTINGS_WAIT_GOAL');
    expect((session?.payload as any)?.onboarding?.lang).toBe('uz');

    const hasEditMarkup = callApiSpy.mock.calls.some(([method]: any[]) => method === 'editMessageReplyMarkup');
    expect(hasEditMarkup).toBe(true);
    expect(sentTexts(callApiSpy).some((text) => text.includes(t('uz', 'askGoal').split('{')[0]!))).toBe(true);
  });

  it('SETTINGS_WAIT_GOAL in onboarding saves goal and asks interval', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru', notificationIntervalMinutes: 30 } });
    await setState(BigInt(userId), 'SETTINGS_WAIT_GOAL', { payload: { onboarding: { lang: 'ru' } } });
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeMessageUpdate('25', 58), {} as any);

    const user = await prisma.user.findUnique({ where: { id: BigInt(userId) } });
    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });

    expect(user?.maxNotificationsPerDay).toBe(25);
    expect(session?.state).toBe('SETTINGS_WAIT_INTERVAL');
    expect((session?.payload as any)?.onboarding?.lang).toBe('ru');
    expect(sentTexts(callApiSpy).some((text) => text.includes(t('ru', 'askInterval').split('{')[0]!))).toBe(true);
  });

  it('SETTINGS_WAIT_INTERVAL rejects non-numeric value', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    await setState(BigInt(userId), 'SETTINGS_WAIT_INTERVAL', { payload: { onboarding: { lang: 'ru' } } });
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeMessageUpdate('abc', 4), {} as any);

    expect(sentTexts(callApiSpy)).toContain(t('ru', 'intervalNeedNumber'));
  });

  it('SETTINGS_WAIT_INTERVAL saves value in regular settings flow', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru', notificationIntervalMinutes: 15 } });
    await setState(BigInt(userId), 'SETTINGS_WAIT_INTERVAL');
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeMessageUpdate('45', 5), {} as any);

    const user = await prisma.user.findUnique({ where: { id: BigInt(userId) } });
    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(user?.notificationIntervalMinutes).toBe(45);
    expect(session?.state).toBe('IDLE');
    expect(sentTexts(callApiSpy)).toContain(t('ru', 'settings.interval.saved', { value: 45 }));
  });

  it('/settings and /stats commands return web app buttons', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeMessageUpdate('/settings', 51), {} as any);
    await bot.handleUpdate(makeMessageUpdate('/stats', 52), {} as any);

    const calls = callApiSpy.mock.calls.filter(([method]: any[]) => method === 'sendMessage');
    expect(calls.length).toBeGreaterThanOrEqual(2);

    const firstMarkup = (calls[0]?.[1] as any)?.reply_markup;
    const secondMarkup = (calls[1]?.[1] as any)?.reply_markup;
    expect(firstMarkup?.inline_keyboard?.[0]?.[0]?.web_app?.url).toBe('https://example.test/app');
    expect(secondMarkup?.inline_keyboard?.[0]?.[0]?.web_app?.url).toBe('https://example.test/app');
  });

  it('settings callback routes interval, limit and main', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    await setState(BigInt(userId), 'IDLE');
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeCallbackUpdate('settings:interval', 53), {} as any);
    let session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(session?.state).toBe('SETTINGS_WAIT_INTERVAL');

    await bot.handleUpdate(makeCallbackUpdate('settings:limit', 54), {} as any);
    session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(session?.state).toBe('SETTINGS_WAIT_GOAL');

    await bot.handleUpdate(makeCallbackUpdate('settings:main', 55), {} as any);
    const hasEdit = callApiSpy.mock.calls.some(([method]: any[]) => method === 'editMessageText');
    expect(hasEdit).toBe(true);
  });

  it('add_confirm callback saves suggested translation', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    await setState(BigInt(userId), 'ADDING_WORD_CONFIRM_TRANSLATION', {
      payload: { wordEn: 'cat', translationRu: 'кот' },
    });
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeCallbackUpdate('add_confirm', 6), {} as any);

    const word = await prisma.word.findFirst({ where: { userId: BigInt(userId), wordEn: 'cat' } });
    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(word?.translationRu).toBe('кот');
    expect(session?.state).toBe('IDLE');
    expect(editedTexts(callApiSpy)).toContain(t('ru', 'add.saved', { en: 'cat', ru: 'кот' }));
  });

  it('add_change callback switches to manual translation state', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    await setState(BigInt(userId), 'ADDING_WORD_CONFIRM_TRANSLATION', {
      payload: { wordEn: 'dog', translationRu: 'собака' },
    });
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeCallbackUpdate('add_change', 7), {} as any);

    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(session?.state).toBe('ADDING_WORD_WAIT_RU_MANUAL');
    expect((session?.payload as any)?.wordEn).toBe('dog');
    expect(editedTexts(callApiSpy)).toContain(t('ru', 'add.manual'));
  });

  it('add_cancel callback resets state and edits cancelled text', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    await setState(BigInt(userId), 'ADDING_WORD_CONFIRM_TRANSLATION', {
      payload: { wordEn: 'bird', translationRu: 'птица' },
    });
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeCallbackUpdate('add_cancel', 56), {} as any);

    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(session?.state).toBe('IDLE');
    expect(editedTexts(callApiSpy)).toContain(t('ru', 'add.cancelled'));
  });

  it('WAITING_ANSWER text transitions to WAITING_GRADE', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    const created = await prisma.word.create({
      data: {
        userId: BigInt(userId),
        wordEn: 'hello',
        translationRu: 'привет',
        review: {
          create: {
            userId: BigInt(userId),
            stage: 0,
            intervalMinutes: 5,
            nextReviewAt: new Date(Date.now() - 1000),
          },
        },
      },
      include: { review: true },
    });

    await setState(BigInt(userId), 'WAITING_ANSWER', {
      reviewId: created.review?.id,
      wordId: created.id,
      direction: 'EN_TO_RU',
      sentAt: new Date(),
      reminderStep: 0,
    });

    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeMessageUpdate('привет', 8), {} as any);

    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(session?.state).toBe('WAITING_GRADE');
    expect((session?.payload as any)?.correct).toBe(true);
    expect(sentTexts(callApiSpy).some((text) => text.includes(t('ru', 'answer.pickGrade')))).toBe(true);
  });

  it('grade callback in non-active state returns noActive message', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    await setState(BigInt(userId), 'IDLE');
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeCallbackUpdate('grade:GOOD', 9), {} as any);

    const answerCbCall = callApiSpy.mock.calls.find(([method]: any[]) => method === 'answerCallbackQuery');
    expect(answerCbCall).toBeTruthy();
    expect(String((answerCbCall?.[1] as any)?.text ?? '')).toBe(t('ru', 'grade.noActive'));
  });

  it('WAITING_GRADE text keeps asking for grade', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    await setState(BigInt(userId), 'WAITING_GRADE');
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeMessageUpdate('any text', 57), {} as any);

    expect(sentTexts(callApiSpy)).toContain(t('ru', 'answer.pickGrade'));
  });

  it('notify toggle callback flips notifications', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru', notificationsEnabled: true } });
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeCallbackUpdate('notify:toggle', 10), {} as any);

    const user = await prisma.user.findUnique({ where: { id: BigInt(userId) } });
    expect(user?.notificationsEnabled).toBe(false);
    const answerCbCall = callApiSpy.mock.calls.find(([method]: any[]) => method === 'answerCallbackQuery');
    expect(String((answerCbCall?.[1] as any)?.text ?? '')).toBe(t('ru', 'notify.toggled'));
  });
});
