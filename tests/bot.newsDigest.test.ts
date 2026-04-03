import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client';
import { prepareTestDatabase } from './helpers/testDb';
import { cleanupUserData } from './helpers/cleanup';

const NEWS_BUTTON_RU = '\u{1F4F0} \u041F\u043E\u0447\u0438\u0442\u0430\u0442\u044C \u043D\u043E\u0432\u043E\u0441\u0442\u0438';
const NEWS_BUTTON_UZ = '\u{1F4F0} Yangiliklarni o\u2018qish';
const NEWS_SOURCE_LABEL_RU = '\u0427\u0438\u0442\u0430\u0442\u044C \u043E\u0440\u0438\u0433\u0438\u043D\u0430\u043B';
const NEWS_SOURCE_LABEL_UZ = 'To\u2018liq o\u2018qish';
const NEWS_NAV_PREV = 'newsnav:prev';
const NEWS_NAV_NEXT = 'newsnav:next';
const NEWS_NAV_NOOP = 'newsnav:noop';
const NEWS_NAV_MORE = 'newsnav:more';

vi.mock('../src/services/translation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/translation')>();
  return {
    ...actual,
    suggestTranslation: vi.fn().mockResolvedValue(null),
    detectAndTranslateWithGemini: vi.fn().mockResolvedValue(null),
  };
});

let bot: any;
let prisma: PrismaClient;

const userId = 900000451;

const nowTs = () => Math.floor(Date.now() / 1000);

const makeMessageUpdate = (text: string, messageId = 1) => ({
  update_id: messageId,
  message: {
    message_id: messageId,
    date: nowTs(),
    text,
    chat: { id: userId, type: 'private' },
    from: { id: userId, is_bot: false, first_name: 'Digest' },
  },
});

const makeCallbackUpdate = (data: string, messageId = 1) => ({
  update_id: messageId,
  callback_query: {
    id: `cb-${messageId}`,
    from: { id: userId, is_bot: false, first_name: 'Digest' },
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

beforeAll(async () => {
  process.env.BOT_TOKEN = process.env.BOT_TOKEN ?? 'test_bot_token';
  process.env.WEBAPP_URL = 'https://example.test/app';
  const testUrl = await prepareTestDatabase();
  process.env.DATABASE_URL = testUrl;

  vi.resetModules();

  const dbMod = await import('../src/db/client');
  prisma = dbMod.prisma;

  const mod = await import('../src/bot/index');
  bot = mod.bot;
});

beforeEach(async () => {
  await cleanupUserData(prisma, BigInt(userId));
  await prisma.newsResolveJob.deleteMany({});
  await prisma.newsCache.deleteMany({});
  vi.restoreAllMocks();
});

afterAll(async () => {
  await cleanupUserData(prisma, BigInt(userId));
  await prisma.newsResolveJob.deleteMany({});
  await prisma.newsCache.deleteMany({});
  await prisma.$disconnect();
});

describe('bot news digest button', () => {
  it('returns one precomputed digest card with source link and arrows, without external fetch', async () => {
    await prisma.user.create({
      data: {
        id: BigInt(userId),
        language: 'ru',
      },
    });

    await prisma.word.create({
      data: {
        userId: BigInt(userId),
        wordEn: 'economy',
        translationRu: 'economy-ru',
        newsExampleText: 'The economy is recovering steadily.',
        newsExampleTier: 'GDELT',
        newsExampleSourceUrl: 'https://news.example/economy',
        newsExampleSourceTitle: 'Daily economy report',
        newsExamplePreparedAt: new Date(),
        reviews: {
          create: {
            userId: BigInt(userId),
            direction: 'EN_TO_RU',
            stage: 4,
            intervalMinutes: 3600,
            nextReviewAt: new Date(Date.now() - 1000),
          },
        },
      },
    });

    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await bot.handleUpdate(makeMessageUpdate(NEWS_BUTTON_RU, 1), {} as any);

    expect(fetchSpy).not.toHaveBeenCalled();

    const sendCalls = callApiSpy.mock.calls.filter(([method]) => method === 'sendMessage');
    expect(sendCalls.length).toBeGreaterThan(0);

    const payload = sendCalls[0]?.[1] as any;
    const text = String(payload?.text ?? '');
    expect(text).toContain('<b>\u{1F4F0} \u041D\u043E\u0432\u043E\u0441\u0442\u044C \u0434\u043D\u044F</b>');
    expect(text).toContain('💡 <b>economy</b> - economy-ru');
    expect(text).toContain('<u><b>ECONOMY</b></u>');
    expect(text).toContain(`<a href="https://news.example/economy">${NEWS_SOURCE_LABEL_RU}</a>`);

    const replyMarkup = typeof payload?.reply_markup === 'string'
      ? JSON.parse(payload.reply_markup)
      : payload?.reply_markup;
    const buttons = replyMarkup?.inline_keyboard?.[0] ?? [];
    expect(buttons.length).toBe(1);
    expect(buttons[0]?.text).toBe('1/1');
    expect(buttons[0]?.callback_data).toBe(NEWS_NAV_NOOP);

    const user = await prisma.user.findUnique({ where: { id: BigInt(userId) } });
    expect(user?.newsDigestLastOpenedAt).toBeTruthy();
  });

  it('shows fallback text and keeps russian keyboard when digest is not ready', async () => {
    await prisma.user.create({
      data: {
        id: BigInt(userId),
        language: 'ru',
      },
    });

    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeMessageUpdate(NEWS_BUTTON_RU, 2), {} as any);

    const sendCalls = callApiSpy.mock.calls.filter(([method]) => method === 'sendMessage');
    const payload = sendCalls
      .map(([, sendPayload]) => sendPayload as any)
      .find((sendPayload) => String(sendPayload?.text ?? '').includes('\u{1F4F0}'));
    const replyMarkup = typeof payload?.reply_markup === 'string'
      ? JSON.parse(payload.reply_markup)
      : payload?.reply_markup;
    const firstButton = replyMarkup?.keyboard?.[0]?.[0];
    const firstButtonText = typeof firstButton === 'string' ? firstButton : firstButton?.text;

    const text = String(payload?.text ?? '');
    expect(text).toContain('📰 <b>Новости пока недоступны</b>');
    expect(text).toContain('Stage 4');
    expect(text).toContain('Как работают этапы?');
    expect(text).toContain('https://example.test/app?tab=settings&flow=stages');
    expect(firstButtonText).toBe(NEWS_BUTTON_RU);
  });

  it('shows source title without link when source URL is missing', async () => {
    await prisma.user.create({
      data: {
        id: BigInt(userId),
        language: 'ru',
      },
    });

    await prisma.word.create({
      data: {
        userId: BigInt(userId),
        wordEn: 'economy',
        translationRu: 'экономика',
        newsExampleText: 'The economy is recovering steadily.',
        newsExampleTier: 'CACHE',
        newsExampleSourceUrl: null,
        newsExampleSourceTitle: 'The Guardian',
        newsExamplePreparedAt: new Date(),
        reviews: {
          create: {
            userId: BigInt(userId),
            direction: 'EN_TO_RU',
            stage: 4,
            intervalMinutes: 3600,
            nextReviewAt: new Date(Date.now() - 1000),
          },
        },
      },
    });

    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeMessageUpdate(NEWS_BUTTON_RU, 22), {} as any);

    const sendCalls = callApiSpy.mock.calls.filter(([method]) => method === 'sendMessage');
    expect(sendCalls.length).toBe(1);
    const payload = sendCalls[0]?.[1] as any;
    const text = String(payload?.text ?? '');
    expect(text).toContain('🔎 Источник: The Guardian');
    expect(text).not.toContain('<a href=');
  });

  it('uses uzbek labels for digest card and source link for uz users', async () => {
    await prisma.user.create({
      data: {
        id: BigInt(userId),
        language: 'uz',
      },
    });

    await prisma.word.create({
      data: {
        userId: BigInt(userId),
        wordEn: 'economy',
        translationRu: 'iqtisod',
        newsExampleText: 'The economy is recovering steadily.',
        newsExampleTier: 'CACHE',
        newsExampleSourceUrl: 'https://news.example/economy',
        newsExampleSourceTitle: 'Daily economy report',
        newsExamplePreparedAt: new Date(),
        reviews: {
          create: {
            userId: BigInt(userId),
            direction: 'EN_TO_RU',
            stage: 4,
            intervalMinutes: 3600,
            nextReviewAt: new Date(Date.now() - 1000),
          },
        },
      },
    });

    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeMessageUpdate(NEWS_BUTTON_UZ, 3), {} as any);

    const sendCalls = callApiSpy.mock.calls.filter(([method]) => method === 'sendMessage');
    expect(sendCalls.length).toBeGreaterThan(0);

    const digestPayload = sendCalls
      .map(([, payload]) => payload as any)
      .find((payload) => String(payload?.text ?? '').includes('<b>economy</b>'));

    expect(digestPayload).toBeTruthy();
    expect(String(digestPayload?.text ?? '')).toContain('<b>\u{1F4F0} Kun yangiligi</b>');
    expect(String(digestPayload?.text ?? '')).toContain('💡 <b>economy</b> - iqtisod');
    expect(String(digestPayload?.text ?? '')).toContain(NEWS_SOURCE_LABEL_UZ);
    const replyMarkup = typeof digestPayload?.reply_markup === 'string'
      ? JSON.parse(digestPayload.reply_markup)
      : digestPayload?.reply_markup;
    const buttons = replyMarkup?.inline_keyboard?.[0] ?? [];
    expect(buttons.length).toBe(1);
    expect(buttons[0]?.text).toBe('1/1');
  });

  it('sends one digest card with arrows when there are five or fewer cards', async () => {
    await prisma.user.create({
      data: {
        id: BigInt(userId),
        language: 'ru',
      },
    });

    await prisma.word.createMany({
      data: [
        {
          userId: BigInt(userId),
          wordEn: 'economy',
          translationRu: 'ekonomika',
          newsExampleText: 'The economy is recovering steadily.',
          newsExampleTier: 'CACHE',
          newsExampleSourceUrl: 'https://news.example/economy',
          newsExampleSourceTitle: 'Economy report',
          newsExamplePreparedAt: new Date(),
        },
        {
          userId: BigInt(userId),
          wordEn: 'market',
          translationRu: 'rynok',
          newsExampleText: 'The market stabilized this week.',
          newsExampleTier: 'GDELT',
          newsExampleSourceUrl: 'https://news.example/market',
          newsExampleSourceTitle: 'Market report',
          newsExamplePreparedAt: new Date(),
        },
        {
          userId: BigInt(userId),
          wordEn: 'policy',
          translationRu: 'politika',
          newsExampleText: 'Policy reforms continue in Uzbekistan.',
          newsExampleTier: 'NEWSDATA',
          newsExampleSourceUrl: 'https://news.example/policy',
          newsExampleSourceTitle: 'Policy report',
          newsExamplePreparedAt: new Date(),
        },
      ],
    });

    const words = await prisma.word.findMany({
      where: { userId: BigInt(userId) },
      select: { id: true },
    });

    await prisma.review.createMany({
      data: words.map((word) => ({
        userId: BigInt(userId),
        wordId: word.id,
        direction: 'EN_TO_RU',
        stage: 4,
        intervalMinutes: 3600,
        nextReviewAt: new Date(Date.now() - 1000),
      })),
    });

    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeMessageUpdate(NEWS_BUTTON_RU, 4), {} as any);

    const sendCalls = callApiSpy.mock.calls.filter(([method]) => method === 'sendMessage');
    expect(sendCalls.length).toBe(1);

    const payload = sendCalls[0]?.[1] as any;
    const text = String(payload?.text ?? '');
    expect(text).toContain('<b>\u{1F4F0} \u041D\u043E\u0432\u043E\u0441\u0442\u044C \u0434\u043D\u044F</b>');
    const hasAnyWord = ['economy', 'market', 'policy'].some((word) => text.includes(`<b>${word}</b>`));
    expect(hasAnyWord).toBe(true);

    const replyMarkup = typeof payload?.reply_markup === 'string'
      ? JSON.parse(payload.reply_markup)
      : payload?.reply_markup;
    const buttons = replyMarkup?.inline_keyboard?.[0] ?? [];
    expect(buttons[0]?.text).toBe('⬅️');
    expect(buttons[0]?.callback_data).toBe(NEWS_NAV_NOOP);
    expect(buttons[1]?.text).toBe('1/3');
    expect(buttons[1]?.callback_data).toBe(NEWS_NAV_NOOP);
    expect(buttons[2]?.text).toBe('➡️');
    expect(buttons[2]?.callback_data).toBe(NEWS_NAV_NEXT);
  });

  it('navigates digest cards with next button', async () => {
    await prisma.user.create({
      data: {
        id: BigInt(userId),
        language: 'ru',
      },
    });

    await prisma.word.createMany({
      data: [
        {
          userId: BigInt(userId),
          wordEn: 'economy',
          translationRu: 'ekonomika',
          newsExampleText: 'The economy is recovering steadily.',
          newsExampleTier: 'CACHE',
          newsExampleSourceUrl: 'https://news.example/economy',
          newsExampleSourceTitle: 'Economy report',
          newsExamplePreparedAt: new Date(),
        },
        {
          userId: BigInt(userId),
          wordEn: 'market',
          translationRu: 'rynok',
          newsExampleText: 'The market stabilized this week.',
          newsExampleTier: 'GDELT',
          newsExampleSourceUrl: 'https://news.example/market',
          newsExampleSourceTitle: 'Market report',
          newsExamplePreparedAt: new Date(),
        },
      ],
    });

    const words = await prisma.word.findMany({
      where: { userId: BigInt(userId) },
      select: { id: true },
    });

    await prisma.review.createMany({
      data: words.map((word) => ({
        userId: BigInt(userId),
        wordId: word.id,
        direction: 'EN_TO_RU',
        stage: 4,
        intervalMinutes: 3600,
        nextReviewAt: new Date(Date.now() - 1000),
      })),
    });

    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeMessageUpdate(NEWS_BUTTON_RU, 50), {} as any);

    const sendCalls = callApiSpy.mock.calls.filter(([method]) => method === 'sendMessage');
    expect(sendCalls.length).toBe(1);
    const firstPayload = sendCalls[0]?.[1] as any;
    const firstText = String(firstPayload?.text ?? '');
    const firstReplyMarkup = typeof firstPayload?.reply_markup === 'string'
      ? JSON.parse(firstPayload.reply_markup)
      : firstPayload?.reply_markup;
    const firstButtons = firstReplyMarkup?.inline_keyboard?.[0] ?? [];
    expect(firstButtons[0]?.text).toBe('⬅️');
    expect(firstButtons[0]?.callback_data).toBe(NEWS_NAV_NOOP);
    expect(firstButtons[1]?.text).toBe('1/2');
    expect(firstButtons[2]?.text).toBe('➡️');

    await bot.handleUpdate(makeCallbackUpdate(NEWS_NAV_NEXT, 50), {} as any);

    const editCalls = callApiSpy.mock.calls.filter(([method]) => method === 'editMessageText');
    expect(editCalls.length).toBeGreaterThan(0);
    const editPayload = editCalls[0]?.[1] as any;
    const editedText = String(editPayload?.text ?? '');

    expect(editedText).not.toBe(firstText);
    expect(editedText).toContain('<b>\u{1F4F0} \u041D\u043E\u0432\u043E\u0441\u0442\u044C \u0434\u043D\u044F</b>');

    const editedReplyMarkup = typeof editPayload?.reply_markup === 'string'
      ? JSON.parse(editPayload.reply_markup)
      : editPayload?.reply_markup;
    const buttons = editedReplyMarkup?.inline_keyboard?.[0] ?? [];
    expect(buttons[0]?.text).toBe('⬅️');
    expect(buttons[0]?.callback_data).toBe(NEWS_NAV_PREV);
    expect(buttons[1]?.text).toBe('2/2');
    expect(buttons[1]?.callback_data).toBe(NEWS_NAV_NOOP);

    await bot.handleUpdate(makeCallbackUpdate(NEWS_NAV_NEXT, 50), {} as any);

    const nextEditPayload = callApiSpy.mock.calls.filter(([method]) => method === 'editMessageText')[1]?.[1] as any;
    const nextEditedText = String(nextEditPayload?.text ?? '');
    const nextReplyMarkup = typeof nextEditPayload?.reply_markup === 'string'
      ? JSON.parse(nextEditPayload.reply_markup)
      : nextEditPayload?.reply_markup;
    const nextButtons = nextReplyMarkup?.inline_keyboard?.[0] ?? [];

    expect(nextEditedText).toBe(editedText);
    expect(nextButtons[0]?.text).toBe('⬅️');
    expect(nextButtons[1]?.text).toBe('2/2');
  });

  it('shows jump button on the fifth card and moves to the next batch', async () => {
    await prisma.user.create({
      data: {
        id: BigInt(userId),
        language: 'ru',
      },
    });

    await prisma.word.createMany({
      data: Array.from({ length: 10 }, (_, index) => ({
        userId: BigInt(userId),
        wordEn: `word${index + 1}`,
        translationRu: `slovo${index + 1}`,
        newsExampleText: `The word${index + 1} appears in this article.`,
        newsExampleTier: 'CACHE',
        newsExampleSourceUrl: `https://news.example/word${index + 1}`,
        newsExampleSourceTitle: `Word ${index + 1} report`,
        newsExamplePreparedAt: new Date(Date.now() + index * 1000),
      })),
    });

    const words = await prisma.word.findMany({
      where: { userId: BigInt(userId) },
      select: { id: true },
    });

    await prisma.review.createMany({
      data: words.map((word) => ({
        userId: BigInt(userId),
        wordId: word.id,
        direction: 'EN_TO_RU',
        stage: 4,
        intervalMinutes: 3600,
        nextReviewAt: new Date(Date.now() - 1000),
      })),
    });

    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeMessageUpdate(NEWS_BUTTON_RU, 60), {} as any);

    const sendCalls = callApiSpy.mock.calls.filter(([method]) => method === 'sendMessage');
    expect(sendCalls.length).toBe(1);

    const firstPayload = sendCalls[0]?.[1] as any;
    const firstReplyMarkup = typeof firstPayload?.reply_markup === 'string'
      ? JSON.parse(firstPayload.reply_markup)
      : firstPayload?.reply_markup;
    const firstButtons = firstReplyMarkup?.inline_keyboard?.[0] ?? [];
    expect(firstButtons[0]?.text).toBe('⬅️');
    expect(firstButtons[0]?.callback_data).toBe(NEWS_NAV_NOOP);
    expect(firstButtons[1]?.text).toBe('1/5');
    expect(firstButtons[2]?.text).toBe('➡️');
    expect(firstReplyMarkup?.inline_keyboard?.length).toBe(1);

    await bot.handleUpdate(makeCallbackUpdate(NEWS_NAV_NEXT, 60), {} as any);
    await bot.handleUpdate(makeCallbackUpdate(NEWS_NAV_NEXT, 60), {} as any);
    await bot.handleUpdate(makeCallbackUpdate(NEWS_NAV_NEXT, 60), {} as any);
    await bot.handleUpdate(makeCallbackUpdate(NEWS_NAV_NEXT, 60), {} as any);

    const editCalls = callApiSpy.mock.calls.filter(([method]) => method === 'editMessageText');
    expect(editCalls.length).toBeGreaterThanOrEqual(4);

    const fifthPayload = editCalls[3]?.[1] as any;
    const fifthText = String(fifthPayload?.text ?? '');
    const fifthReplyMarkup = typeof fifthPayload?.reply_markup === 'string'
      ? JSON.parse(fifthPayload.reply_markup)
      : fifthPayload?.reply_markup;
    const fifthButtonsRow1 = fifthReplyMarkup?.inline_keyboard?.[0] ?? [];

    expect(fifthText).not.toBe(String(firstPayload?.text ?? ''));
    expect(fifthButtonsRow1.length).toBe(2);
    expect(fifthButtonsRow1[0]?.text).toBe('⬅️');
    expect(fifthButtonsRow1[0]?.callback_data).toBe(NEWS_NAV_PREV);
    expect(fifthButtonsRow1[1]?.text).toBe('📚 Ещё 5 • 5/10');
    expect(fifthButtonsRow1[1]?.callback_data).toBe(NEWS_NAV_MORE);
    expect(fifthReplyMarkup?.inline_keyboard?.length).toBe(1);

    await bot.handleUpdate(makeCallbackUpdate(NEWS_NAV_MORE, 60), {} as any);

    const morePayload = callApiSpy.mock.calls.filter(([method]) => method === 'editMessageText')[4]?.[1] as any;
    const moreText = String(morePayload?.text ?? '');
    const moreReplyMarkup = typeof morePayload?.reply_markup === 'string'
      ? JSON.parse(morePayload.reply_markup)
      : morePayload?.reply_markup;
    const moreButtons = moreReplyMarkup?.inline_keyboard?.[0] ?? [];

    expect(moreText).not.toBe(fifthText);
    expect(moreButtons[0]?.text).toBe('⬅️');
    expect(moreButtons[0]?.callback_data).toBe(NEWS_NAV_PREV);
    expect(moreButtons[1]?.text).toBe('1/5');
    expect(moreButtons[1]?.callback_data).toBe(NEWS_NAV_NOOP);
    expect(moreButtons[2]?.text).toBe('➡️');
    expect(moreButtons[2]?.callback_data).toBe(NEWS_NAV_NEXT);
    expect(moreReplyMarkup?.inline_keyboard?.length).toBe(1);
  });

  it('uses the actual size for the last partial batch', async () => {
    await prisma.user.create({
      data: {
        id: BigInt(userId),
        language: 'ru',
      },
    });

    await prisma.word.createMany({
      data: Array.from({ length: 7 }, (_, index) => ({
        userId: BigInt(userId),
        wordEn: `term${index + 1}`,
        translationRu: `slovo${index + 1}`,
        newsExampleText: `The term${index + 1} appears in this article.`,
        newsExampleTier: 'CACHE',
        newsExampleSourceUrl: `https://news.example/term${index + 1}`,
        newsExampleSourceTitle: `Term ${index + 1} report`,
        newsExamplePreparedAt: new Date(Date.now() + index * 1000),
      })),
    });

    const words = await prisma.word.findMany({
      where: { userId: BigInt(userId) },
      select: { id: true },
    });

    await prisma.review.createMany({
      data: words.map((word) => ({
        userId: BigInt(userId),
        wordId: word.id,
        direction: 'EN_TO_RU',
        stage: 4,
        intervalMinutes: 3600,
        nextReviewAt: new Date(Date.now() - 1000),
      })),
    });

    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeMessageUpdate(NEWS_BUTTON_RU, 70), {} as any);
    await bot.handleUpdate(makeCallbackUpdate(NEWS_NAV_NEXT, 70), {} as any);
    await bot.handleUpdate(makeCallbackUpdate(NEWS_NAV_NEXT, 70), {} as any);
    await bot.handleUpdate(makeCallbackUpdate(NEWS_NAV_NEXT, 70), {} as any);
    await bot.handleUpdate(makeCallbackUpdate(NEWS_NAV_NEXT, 70), {} as any);
    await bot.handleUpdate(makeCallbackUpdate(NEWS_NAV_MORE, 70), {} as any);

    const morePayload = callApiSpy.mock.calls.filter(([method]) => method === 'editMessageText')[4]?.[1] as any;
    const moreReplyMarkup = typeof morePayload?.reply_markup === 'string'
      ? JSON.parse(morePayload.reply_markup)
      : morePayload?.reply_markup;
    const moreButtons = moreReplyMarkup?.inline_keyboard?.[0] ?? [];

    expect(String(morePayload?.text ?? '')).not.toBe(String(callApiSpy.mock.calls.filter(([method]) => method === 'sendMessage')[0]?.[1]?.text ?? ''));
    expect(moreButtons[0]?.text).toBe('⬅️');
    expect(moreButtons[0]?.callback_data).toBe(NEWS_NAV_PREV);
    expect(moreButtons[1]?.text).toBe('1/2');
    expect(moreButtons[1]?.callback_data).toBe(NEWS_NAV_NOOP);
    expect(moreButtons[2]?.text).toBe('➡️');
    expect(moreButtons[2]?.callback_data).toBe(NEWS_NAV_NEXT);
  });
});
