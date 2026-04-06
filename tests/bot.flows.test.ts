import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../src/generated/prisma/client';
import { prepareTestDatabase } from './helpers/testDb';
import { cleanupUserData } from './helpers/cleanup';
import { t } from '../src/i18n';

const suggestTranslationMock = vi.fn().mockResolvedValue(null as string | null);
const translateAutoMock = vi.fn().mockResolvedValue('hello' as string | null);
const translateAutoWithMyMemoryMock = vi.fn().mockResolvedValue('beta-ru' as string | null);
const detectAndTranslateWithGeminiMock = vi.fn().mockResolvedValue(null as any);
const checkAutoTranslateQuotaMock = vi.fn();
const commitAutoTranslateQuotaMock = vi.fn();
let realCheckAutoTranslateQuota: any;
let realCommitAutoTranslateQuota: any;

vi.mock('../src/services/translation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/translation')>();
  return {
    ...actual,
    suggestTranslation: suggestTranslationMock,
    translateAuto: translateAutoMock,
    translateAutoWithMyMemory: translateAutoWithMyMemoryMock,
    detectAndTranslateWithGemini: detectAndTranslateWithGeminiMock,
  };
});

vi.mock('../src/services/translationQuota', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/translationQuota')>();
  realCheckAutoTranslateQuota = actual.checkAutoTranslateQuota;
  realCommitAutoTranslateQuota = actual.commitAutoTranslateQuota;
  return {
    ...actual,
    checkAutoTranslateQuota: (...args: any[]) => checkAutoTranslateQuotaMock(...args),
    commitAutoTranslateQuota: (...args: any[]) => commitAutoTranslateQuotaMock(...args),
    consumeAutoTranslateQuota: (...args: any[]) => commitAutoTranslateQuotaMock(...args),
  };
});

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
  translateAutoMock.mockReset();
  translateAutoMock.mockResolvedValue('hello');
  translateAutoWithMyMemoryMock.mockReset();
  translateAutoWithMyMemoryMock.mockResolvedValue('beta-ru');
  detectAndTranslateWithGeminiMock.mockReset();
  detectAndTranslateWithGeminiMock.mockResolvedValue(null);
  checkAutoTranslateQuotaMock.mockReset();
  checkAutoTranslateQuotaMock.mockImplementation((...args: any[]) => realCheckAutoTranslateQuota(...args));
  commitAutoTranslateQuotaMock.mockReset();
  commitAutoTranslateQuotaMock.mockImplementation((...args: any[]) => realCommitAutoTranslateQuota(...args));
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
    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(user?.language).toBe('uz');
    expect(session?.state).toBe('IDLE');
    expect((session?.payload as any)?.onboarding?.step).toBe('intro');
    expect((session?.payload as any)?.onboarding?.lang).toBe('uz');

    const answerCb = callApiSpy.mock.calls.find(([method]: any[]) => method === 'answerCallbackQuery');
    expect(answerCb).toBeTruthy();
    expect(sentTexts(callApiSpy)).toContain(t('uz', 'hint'));
  });

  it('does not accept plain text before language is chosen', async () => {
    await prisma.user.create({ data: { id: BigInt(userId) } });
    await setState(BigInt(userId), 'IDLE', { payload: { onboarding: { step: 'lang' } } });
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeMessageUpdate('hello', 20), {} as any);

    const texts = sentTexts(callApiSpy);
    expect(texts.some((text) => text.includes(t('ru', 'chooseLang')))).toBe(true);
    expect(texts.some((text) => text.includes(t('uz', 'chooseLang')))).toBe(true);
    expect(translateAutoMock).not.toHaveBeenCalled();
    expect(await prisma.word.count({ where: { userId: BigInt(userId) } })).toBe(0);
  });

  it('does not accept plain text before onboarding next is pressed', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    await setState(BigInt(userId), 'IDLE', { payload: { onboarding: { step: 'intro', lang: 'ru' } } });
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeMessageUpdate('hello', 21), {} as any);

    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(session?.state).toBe('IDLE');
    expect((session?.payload as any)?.onboarding?.step).toBe('intro');
    expect(sentTexts(callApiSpy)).toContain(t('ru', 'hint'));
    expect(translateAutoMock).not.toHaveBeenCalled();
    expect(await prisma.word.count({ where: { userId: BigInt(userId) } })).toBe(0);
  });

  it('blocks /add until onboarding next is pressed', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    await setState(BigInt(userId), 'IDLE', { payload: { onboarding: { step: 'intro', lang: 'ru' } } });
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeMessageUpdate('/add', 22), {} as any);

    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(session?.state).toBe('IDLE');
    expect(sentTexts(callApiSpy)).toContain(t('ru', 'hint'));
    expect(sentTexts(callApiSpy)).not.toContain(t('ru', 'add.enter'));
  });

  it('blocks quiz entry until onboarding next is pressed', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    await setState(BigInt(userId), 'IDLE', { payload: { onboarding: { step: 'intro', lang: 'ru' } } });
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeMessageUpdate('\u{1F9E0} Quiz', 23), {} as any);

    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(session?.state).toBe('IDLE');
    expect(sentTexts(callApiSpy)).toContain(t('ru', 'hint'));
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

  it('SETTINGS_WAIT_INTERVAL in onboarding sends finished message with hidden guide text', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'uz', notificationIntervalMinutes: 15 } });
    await setState(BigInt(userId), 'SETTINGS_WAIT_INTERVAL', { payload: { onboarding: { lang: 'uz' } } });
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeMessageUpdate('10', 41), {} as any);

    const user = await prisma.user.findUnique({ where: { id: BigInt(userId) } });
    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    const texts = sentTexts(callApiSpy);

    expect(user?.notificationIntervalMinutes).toBe(10);
    expect(session?.state).toBe('IDLE');
    expect(texts).toContain(t('uz', 'onboarding.finished', {
      value: 10,
      guideLink:
        '<a href="https://t.me/WordPing_bot/app?startapp=stages"><tg-spoiler>Bosqichlar qanday ishlaydi?</tg-spoiler></a>',
    }));
    expect(
      texts.some((text) =>
        text.includes('<a href="https://t.me/WordPing_bot/app?startapp=stages"><tg-spoiler>Bosqichlar qanday ishlaydi?</tg-spoiler></a>')
      )
    ).toBe(true);
    expect(texts).not.toContain(t('uz', 'reviewFlowHint'));
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
    const edited = editedTexts(callApiSpy).join('\n');
    expect(edited).toContain('cat');
    expect(edited).toContain('кот');
  });

  it('checks duplicate before calling auto-translation API', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    await prisma.word.create({
      data: {
        userId: BigInt(userId),
        wordEn: 'apple',
        translationRu: 'яблоко',
      },
    });
    await setState(BigInt(userId), 'ADDING_WORD_WAIT_EN');

    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    suggestTranslationMock.mockResolvedValue('должно-не-вызываться');

    await bot.handleUpdate(makeMessageUpdate('apple', 59), {} as any);

    expect(suggestTranslationMock).not.toHaveBeenCalled();
    const duplicateMsg = sentTexts(callApiSpy).find(
      (text) => text.includes('apple') && text.includes('яблоко')
    );
    expect(duplicateMsg).toBeTruthy();
  });

  it('treats normalized unicode variants as duplicates before translation API', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    await prisma.word.create({
      data: {
        userId: BigInt(userId),
        wordEn: 'CAF\u00C9',
        translationRu: '\u043a\u043e\u0444\u0435',
      },
    });
    await setState(BigInt(userId), 'ADDING_WORD_WAIT_EN');

    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    suggestTranslationMock.mockResolvedValue('\u043d\u0435-\u0434\u043e\u043b\u0436\u043d\u043e-\u0432\u044b\u0437\u0432\u0430\u0442\u044c\u0441\u044f');

    await bot.handleUpdate(makeMessageUpdate('cafe\u0301', 601), {} as any);

    expect(suggestTranslationMock).not.toHaveBeenCalled();
    const duplicateMsg = sentTexts(callApiSpy).find(
      (text) => text.includes('CAF\u00C9') && text.includes('\u043a\u043e\u0444\u0435')
    );
    expect(duplicateMsg).toBeTruthy();
  });

  it('shows suggested pair in user input order for russian source input', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    await setState(BigInt(userId), 'ADDING_WORD_WAIT_EN');
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    translateAutoMock.mockResolvedValue('hello');

    await bot.handleUpdate(makeMessageUpdate('привет', 62), {} as any);

    const suggestMsg = sentTexts(callApiSpy).find((text) => text.includes('Как тебе такой перевод?'));
    expect(suggestMsg).toBeTruthy();
    expect(String(suggestMsg)).toContain('🇷🇺 <b>привет</b> — 🇺🇸');
    expect(String(suggestMsg)).toContain('hello');
  });

  it('shows searching translation message before processing add flow', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    await setState(BigInt(userId), 'ADDING_WORD_WAIT_EN');
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeMessageUpdate('alpha', 70), {} as any);

    expect(sentTexts(callApiSpy)).toContain(t('ru', 'add.searchingTranslation'));
  });

  it('uses Gemini disambiguation for ambiguous latin input', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    await setState(BigInt(userId), 'ADDING_WORD_WAIT_EN');
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    detectAndTranslateWithGeminiMock.mockResolvedValue({
      sourceLang: 'en',
      targetLang: 'ru',
      translatedText: '\u0432\u0435\u0442\u0447\u0438\u043d\u0430',
      confidence: 0.91,
    });

    await bot.handleUpdate(makeMessageUpdate('ham', 63), {} as any);

    expect(detectAndTranslateWithGeminiMock).toHaveBeenCalledTimes(1);
    expect(translateAutoMock).not.toHaveBeenCalled();
    const suggestMsg = sentTexts(callApiSpy).find(
      (text) => text.includes('ham') && text.includes('\u0432\u0435\u0442\u0447\u0438\u043d\u0430')
    );
    expect(suggestMsg).toBeTruthy();
  });

  it('switches to manual input when english auto-translation looks suspicious', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    await setState(BigInt(userId), 'ADDING_WORD_WAIT_EN');
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    suggestTranslationMock.mockResolvedValue('hello');

    await bot.handleUpdate(makeMessageUpdate('hello', 68), {} as any);

    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(session?.state).toBe('ADDING_WORD_WAIT_RU_MANUAL');
    expect((session?.payload as any)?.wordEn).toBe('hello');
    expect(sentTexts(callApiSpy)).toContain(t('ru', 'add.suspectAutoTranslation'));
  });

  it('switches to manual input when translated english candidate looks technical', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    await setState(BigInt(userId), 'ADDING_WORD_WAIT_EN');
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    detectAndTranslateWithGeminiMock.mockResolvedValue(null);
    translateAutoMock.mockResolvedValue('c/dictation');

    await bot.handleUpdate(makeMessageUpdate('salom', 69), {} as any);

    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(session?.state).toBe('ADDING_WORD_WAIT_RU_MANUAL');
    expect((session?.payload as any)?.manualField).toBe('en');
    expect((session?.payload as any)?.sourceNative).toBe('salom');
    expect(sentTexts(callApiSpy)).toContain(t('ru', 'add.needEnglishWord'));
  });

  it('saves manual english input after suspicious native-to-english translation', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    await setState(BigInt(userId), 'ADDING_WORD_WAIT_EN');
    vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    detectAndTranslateWithGeminiMock.mockResolvedValue(null);
    translateAutoMock.mockResolvedValue('c/dictation');

    await bot.handleUpdate(makeMessageUpdate('salom', 70), {} as any);
    await bot.handleUpdate(makeMessageUpdate('hello', 71), {} as any);

    const saved = await prisma.word.findFirst({
      where: { userId: BigInt(userId), wordEn: 'hello' },
    });
    expect(saved?.translationRu).toBe('salom');

    const wrong = await prisma.word.findFirst({
      where: { userId: BigInt(userId), wordEn: 'c/dictation' },
    });
    expect(wrong).toBeNull();
  });

  it('shows neutral flag for ambiguous latin input to avoid misleading language flag', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    await setState(BigInt(userId), 'ADDING_WORD_WAIT_EN');
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    suggestTranslationMock.mockResolvedValue('ham-ru');

    await bot.handleUpdate(makeMessageUpdate('ham', 67), {} as any);

    const suggestMsg = sentTexts(callApiSpy).find(
      (text) => text.includes('<b>ham</b>') && text.includes('ham-ru')
    );
    expect(suggestMsg).toBeTruthy();
    expect(String(suggestMsg)).toContain('🌐 <b>ham</b> —');
  });

  it('shows uz flag for suggested native translation on uz interface', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'uz' } });
    await setState(BigInt(userId), 'ADDING_WORD_WAIT_EN');
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    suggestTranslationMock.mockResolvedValue('kelishuv');

    await bot.handleUpdate(makeMessageUpdate('consensus', 64), {} as any);

    const suggestMsg = sentTexts(callApiSpy).find(
      (text) => text.includes('consensus') && text.includes('kelishuv')
    );
    expect(suggestMsg).toBeTruthy();
    expect(String(suggestMsg)).toContain('\uD83C\uDDFA\uD83C\uDDF8 <b>consensus</b> — \uD83C\uDDFA\uD83C\uDDFF kelishuv');
  });

  it('uses MyMemory fallback when daily auto-translate limit is reached', async () => {
    const previousDailyLimit = process.env.DAILY_AUTO_TRANSLATE_LIMIT;
    process.env.DAILY_AUTO_TRANSLATE_LIMIT = '1';

    try {
      await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
      suggestTranslationMock.mockResolvedValue('альфа');
      const callApiSpy = vi
        .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
        .mockResolvedValue({} as any);

      await setState(BigInt(userId), 'ADDING_WORD_WAIT_EN');
      await bot.handleUpdate(makeMessageUpdate('alpha', 60), {} as any);
      expect(suggestTranslationMock).toHaveBeenCalledTimes(1);

      await setState(BigInt(userId), 'ADDING_WORD_WAIT_EN');
      await bot.handleUpdate(makeMessageUpdate('beta', 61), {} as any);

      const texts = sentTexts(callApiSpy);
      expect(texts).not.toContain(t('ru', 'add.apiLimitManualTranslation', { limit: 1 }));
      expect(texts).toContain(t('ru', 'add.apiLimitFallbackQuality', { limit: 1 }));
      expect(texts.some((text) => text.includes('beta') && text.includes('beta-ru'))).toBe(true);
      expect(suggestTranslationMock).toHaveBeenCalledTimes(1);
      expect(translateAutoWithMyMemoryMock).toHaveBeenCalled();
    } finally {
      if (previousDailyLimit === undefined) {
        delete process.env.DAILY_AUTO_TRANSLATE_LIMIT;
      } else {
        process.env.DAILY_AUTO_TRANSLATE_LIMIT = previousDailyLimit;
      }
    }
  });

  it('switches to manual native translation when fallback fails after daily limit', async () => {
    const previousDailyLimit = process.env.DAILY_AUTO_TRANSLATE_LIMIT;
    process.env.DAILY_AUTO_TRANSLATE_LIMIT = '1';

    try {
      await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
      const callApiSpy = vi
        .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
        .mockResolvedValue({} as any);

      suggestTranslationMock.mockResolvedValueOnce('Р°Р»СЊС„Р°');

      await setState(BigInt(userId), 'ADDING_WORD_WAIT_EN');
      await bot.handleUpdate(makeMessageUpdate('alpha', 69), {} as any);

      translateAutoWithMyMemoryMock.mockResolvedValueOnce(null);

      await setState(BigInt(userId), 'ADDING_WORD_WAIT_EN');
      await bot.handleUpdate(makeMessageUpdate('beta', 70), {} as any);

      const texts = sentTexts(callApiSpy);
      expect(texts).toContain(t('ru', 'add.apiLimitManualTranslation', { limit: 1 }));
      expect(texts).not.toContain(t('ru', 'add.error'));

      const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
      expect(session?.state).toBe('ADDING_WORD_WAIT_RU_MANUAL');
      expect((session?.payload as any)?.wordEn).toBe('beta');
      expect(translateAutoWithMyMemoryMock).toHaveBeenCalledWith('beta', 'ru');
    } finally {
      if (previousDailyLimit === undefined) {
        delete process.env.DAILY_AUTO_TRANSLATE_LIMIT;
      } else {
        process.env.DAILY_AUTO_TRANSLATE_LIMIT = previousDailyLimit;
      }
    }
  });

  it('asks for manual english word when reverse fallback fails after daily limit', async () => {
    const previousDailyLimit = process.env.DAILY_AUTO_TRANSLATE_LIMIT;
    process.env.DAILY_AUTO_TRANSLATE_LIMIT = '1';

    try {
      await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
      const callApiSpy = vi
        .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
        .mockResolvedValue({} as any);

      suggestTranslationMock.mockResolvedValueOnce('Р°Р»СЊС„Р°');

      await setState(BigInt(userId), 'ADDING_WORD_WAIT_EN');
      await bot.handleUpdate(makeMessageUpdate('alpha', 71), {} as any);

      translateAutoWithMyMemoryMock.mockResolvedValueOnce(null);

      await setState(BigInt(userId), 'ADDING_WORD_WAIT_EN');
      await bot.handleUpdate(makeMessageUpdate('РїСЂРёРІРµС‚', 72), {} as any);

      const texts = sentTexts(callApiSpy);
      expect(texts).toContain(t('ru', 'add.apiLimitNeedEnglish', { limit: 1 }));
      expect(texts).not.toContain(t('ru', 'add.error'));

      const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
      expect(session?.state).toBe('ADDING_WORD_WAIT_EN');
      expect(translateAutoWithMyMemoryMock).toHaveBeenCalledWith('РїСЂРёРІРµС‚', 'en');
    } finally {
      if (previousDailyLimit === undefined) {
        delete process.env.DAILY_AUTO_TRANSLATE_LIMIT;
      } else {
        process.env.DAILY_AUTO_TRANSLATE_LIMIT = previousDailyLimit;
      }
    }
  });

  it('does not call Gemini when daily limit is reached for ambiguous latin input', async () => {
    const previousDailyLimit = process.env.DAILY_AUTO_TRANSLATE_LIMIT;
    process.env.DAILY_AUTO_TRANSLATE_LIMIT = '1';

    try {
      await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
      const callApiSpy = vi
        .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
        .mockResolvedValue({} as any);
      suggestTranslationMock.mockResolvedValueOnce('альфа');

      await setState(BigInt(userId), 'ADDING_WORD_WAIT_EN');
      await bot.handleUpdate(makeMessageUpdate('alpha', 65), {} as any);

      detectAndTranslateWithGeminiMock.mockClear();
      translateAutoWithMyMemoryMock.mockClear();

      await setState(BigInt(userId), 'ADDING_WORD_WAIT_EN');
      await bot.handleUpdate(makeMessageUpdate('ham', 66), {} as any);

      expect(sentTexts(callApiSpy)).toContain(t('ru', 'add.apiLimitFallbackQuality', { limit: 1 }));
      expect(detectAndTranslateWithGeminiMock).not.toHaveBeenCalled();
      expect(translateAutoWithMyMemoryMock).toHaveBeenCalledWith('ham', 'ru');
      expect(sentTexts(callApiSpy).some((text) => text.includes('ham') && text.includes('beta-ru'))).toBe(true);
    } finally {
      if (previousDailyLimit === undefined) {
        delete process.env.DAILY_AUTO_TRANSLATE_LIMIT;
      } else {
        process.env.DAILY_AUTO_TRANSLATE_LIMIT = previousDailyLimit;
      }
    }
  });

  it('does not spend auto-translate quota when translation fails and goes manual', async () => {
    const previousDailyLimit = process.env.DAILY_AUTO_TRANSLATE_LIMIT;
    process.env.DAILY_AUTO_TRANSLATE_LIMIT = '1';

    try {
      await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
      const callApiSpy = vi
        .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
        .mockResolvedValue({} as any);

      suggestTranslationMock.mockResolvedValueOnce(null).mockResolvedValueOnce('бета');

      await setState(BigInt(userId), 'ADDING_WORD_WAIT_EN');
      await bot.handleUpdate(makeMessageUpdate('alpha', 67), {} as any);

      await setState(BigInt(userId), 'ADDING_WORD_WAIT_EN');
      await bot.handleUpdate(makeMessageUpdate('beta', 68), {} as any);

      const texts = sentTexts(callApiSpy);
      expect(texts).toContain(t('ru', 'add.noSuggest', { en: 'alpha' }));
      expect(texts).not.toContain(t('ru', 'add.apiLimitFallbackQuality', { limit: 1 }));
      expect(texts.some((text) => text.includes('beta') && text.includes('бета'))).toBe(true);

      expect(suggestTranslationMock).toHaveBeenCalledTimes(2);
      expect(translateAutoWithMyMemoryMock).not.toHaveBeenCalled();
    } finally {
      if (previousDailyLimit === undefined) {
        delete process.env.DAILY_AUTO_TRANSLATE_LIMIT;
      } else {
        process.env.DAILY_AUTO_TRANSLATE_LIMIT = previousDailyLimit;
      }
    }
  });

  it('tells the user when quota is taken by another request after a successful check', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    await setState(BigInt(userId), 'ADDING_WORD_WAIT_EN');

    checkAutoTranslateQuotaMock.mockResolvedValue({
      allowed: true,
      unlimited: false,
      limit: 1,
      used: 0,
      remaining: 1,
    });
    commitAutoTranslateQuotaMock.mockResolvedValue({
      allowed: false,
      unlimited: false,
      limit: 1,
      used: 1,
      remaining: 0,
    });
    suggestTranslationMock.mockResolvedValueOnce('\u0430\u043b\u044c\u0444\u0430');

    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeMessageUpdate('alpha', 602), {} as any);

    const texts = sentTexts(callApiSpy);
    expect(texts).toContain(t('ru', 'add.apiLimitReachedNow', { limit: 1 }));
    expect(texts.some((text) => text.includes('alpha') && text.includes('\u0430\u043b\u044c\u0444\u0430'))).toBe(true);

    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(session?.state).toBe('ADDING_WORD_CONFIRM_TRANSLATION');
  });

  it('add_change callback opens edit choice menu', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    await setState(BigInt(userId), 'ADDING_WORD_CONFIRM_TRANSLATION', {
      payload: { wordEn: 'dog', translationRu: 'собака' },
    });
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeCallbackUpdate('add_change', 7), {} as any);

    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(session?.state).toBe('ADDING_WORD_CONFIRM_TRANSLATION');
    expect((session?.payload as any)?.wordEn).toBe('dog');
    expect(editedTexts(callApiSpy)).toContain(t('ru', 'add.editChoice'));
  });

  it('add_change_word callback switches to english word input state', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    await setState(BigInt(userId), 'ADDING_WORD_CONFIRM_TRANSLATION', {
      payload: { wordEn: 'dog', translationRu: 'СЃРѕР±Р°РєР°' },
    });
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeCallbackUpdate('add_change_word', 77), {} as any);

    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(session?.state).toBe('ADDING_WORD_WAIT_EN');
    expect(editedTexts(callApiSpy)).toContain(t('ru', 'add.manualEnglish'));
  });

  it('add_change_translation callback switches to manual translation state', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    await setState(BigInt(userId), 'ADDING_WORD_CONFIRM_TRANSLATION', {
      payload: { wordEn: 'dog', translationRu: 'СЃРѕР±Р°РєР°' },
    });
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeCallbackUpdate('add_change_translation', 78), {} as any);

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

  it('swap callback does not remove sentence when pool already has only 2 examples', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    const word = await prisma.word.create({
      data: {
        userId: BigInt(userId),
        wordEn: 'hold',
        translationRu: 'держать',
        sentenceIndex: 0,
        exampleSentences: [
          { en: 'Hold the door please.', native: 'Подержи дверь, пожалуйста.' },
          { en: 'Hold this bag for me.', native: 'Подержи эту сумку для меня.' },
        ] as any,
      },
    });
    await setState(BigInt(userId), 'WAITING_ANSWER', {
      wordId: word.id,
      direction: 'EN_TO_RU',
      sentAt: new Date(),
      reminderStep: 0,
    });
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeCallbackUpdate(`swap:${word.id}:0`, 561), {} as any);

    const freshWord = await prisma.word.findUnique({ where: { id: word.id } });
    const sentences = (freshWord?.exampleSentences ?? []) as any[];
    expect(sentences).toHaveLength(2);

    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(session?.state).toBe('WAITING_ANSWER');
    const deleted = callApiSpy.mock.calls.some(([method]: any[]) => method === 'deleteMessage');
    expect(deleted).toBe(false);

    const answerCbCall = callApiSpy.mock.calls.find(([method]: any[]) => method === 'answerCallbackQuery');
    expect(String((answerCbCall?.[1] as any)?.text ?? '')).toContain('минимум 2');
  });

  it('swap callback removes one sentence when pool has 3 and edits message with next sentence', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    const word = await prisma.word.create({
      data: {
        userId: BigInt(userId),
        wordEn: 'accept',
        translationRu: 'принимать',
        sentenceIndex: 0,
        exampleSentences: [
          { en: 'He refused to accept money.', native: 'Он отказался принимать деньги.' },
          { en: 'They accept your request quickly.', native: 'Они быстро принимают ваш запрос.' },
          { en: 'Please accept this small gift.', native: 'Пожалуйста, примите этот небольшой подарок.' },
        ] as any,
        reviews: {
          create: {
            direction: 'EN_TO_RU',
            userId: BigInt(userId),
            stage: 3,
            intervalMinutes: 1200,
            nextReviewAt: new Date(Date.now() - 1000),
          },
        },
      },
      include: { reviews: true },
    });
    const reviewId = word.reviews[0]!.id;
    await setState(BigInt(userId), 'WAITING_ANSWER', {
      wordId: word.id,
      reviewId,
      direction: 'EN_TO_RU',
      sentAt: new Date(),
      reminderStep: 0,
    });
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeCallbackUpdate(`swap:${word.id}:1`, 562), {} as any);

    const freshWord = await prisma.word.findUnique({ where: { id: word.id } });
    const sentences = (freshWord?.exampleSentences ?? []) as any[];
    expect(sentences).toHaveLength(2);

    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(session?.state).toBe('WAITING_ANSWER');
    const edited = callApiSpy.mock.calls.some(([method]: any[]) => method === 'editMessageText');
    expect(edited).toBe(true);

    const answerCbCall = callApiSpy.mock.calls.find(([method]: any[]) => method === 'answerCallbackQuery');
    expect(String((answerCbCall?.[1] as any)?.text ?? '')).toContain('Пример заменён');
  });

  it('hint callback reveals letters in 4 steps per card and then stops', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    const created = await prisma.word.create({
      data: {
        userId: BigInt(userId),
        wordEn: 'apple',
        translationRu: 'яблоко',
        reviews: {
          create: {
            direction: 'RU_TO_EN',
            userId: BigInt(userId),
            stage: 4,
            intervalMinutes: 1200,
            nextReviewAt: new Date(Date.now() - 1000),
          },
        },
      },
      include: { reviews: true },
    });
    const reviewId = created.reviews[0]!.id;

    await setState(BigInt(userId), 'WAITING_ANSWER', {
      reviewId,
      wordId: created.id,
      direction: 'RU_TO_EN',
      sentAt: new Date(),
      reminderStep: 0,
      payload: {
        cardBaseText: '🧠 <b>Вспомнишь слово?</b>\n\n🗣 Это большое <b>яблоко</b>.\n✍️ → 🇬🇧',
        hintTarget: 'apple',
        hintPresses: 0,
        hintReviewId: reviewId,
        swapData: null,
      },
    });

    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeCallbackUpdate(`hint:${reviewId}`, 571), {} as any);
    await bot.handleUpdate(makeCallbackUpdate(`hint:${reviewId}`, 572), {} as any);
    await bot.handleUpdate(makeCallbackUpdate(`hint:${reviewId}`, 573), {} as any);
    await bot.handleUpdate(makeCallbackUpdate(`hint:${reviewId}`, 574), {} as any);
    await bot.handleUpdate(makeCallbackUpdate(`hint:${reviewId}`, 575), {} as any);

    const edits = editedTexts(callApiSpy);
    expect(edits.some((text) => text.includes('<b>a____</b>'))).toBe(true);
    expect(edits.some((text) => text.includes('<b>ap___</b>'))).toBe(true);
    expect(edits.some((text) => text.includes('<b>ap__e</b>'))).toBe(true);
    expect(edits.some((text) => text.includes('<b>app_e</b>'))).toBe(true);

    const answers = callApiSpy.mock.calls
      .filter(([method]: any[]) => method === 'answerCallbackQuery')
      .map(([, payload]: any[]) => String(payload?.text ?? ''));
    expect(answers.some((text) => text.includes('1/4'))).toBe(true);
    expect(answers.some((text) => text.includes('2/4'))).toBe(true);
    expect(answers.some((text) => text.includes('3/4'))).toBe(true);
    expect(answers.some((text) => text.includes('4/4'))).toBe(true);
    expect(answers).toContain(t('ru', 'worker.hintLimit', { count: 4 }));

    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect((session?.payload as any)?.hintPresses).toBe(4);
  });

  it('hint callback can inject masked letters into sentence blank for stage 7 style cards', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    const created = await prisma.word.create({
      data: {
        userId: BigInt(userId),
        wordEn: 'apple',
        translationRu: 'яблоко',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
            userId: BigInt(userId),
            stage: 7,
            intervalMinutes: 43200,
            nextReviewAt: new Date(Date.now() - 1000),
          },
        },
      },
      include: { reviews: true },
    });
    const reviewId = created.reviews[0]!.id;

    await setState(BigInt(userId), 'WAITING_ANSWER', {
      reviewId,
      wordId: created.id,
      direction: 'EN_TO_RU',
      sentAt: new Date(),
      reminderStep: 0,
      payload: {
        cardBaseText: '🧠 <b>Вспомнишь слово?</b>\n\n🗣 She ate one ___.\n✍️ → 🇷🇺',
        hintTarget: 'яблоко',
        hintPresses: 0,
        hintReviewId: reviewId,
        swapData: null,
        hintInline: true,
      },
    });

    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeCallbackUpdate(`hint:${reviewId}`, 575), {} as any);

    const edits = editedTexts(callApiSpy);
    expect(edits.some((text) => text.includes('🗣 She ate one я_____'))).toBe(true);
    expect(edits.some((text) => text.includes('💡 <b>'))).toBe(false);
  });

  it('hint callback returns unavailable for very short words', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    const reviewId = 777;

    await setState(BigInt(userId), 'WAITING_ANSWER', {
      reviewId,
      wordId: 1,
      direction: 'RU_TO_EN',
      sentAt: new Date(),
      reminderStep: 0,
      payload: {
        cardBaseText: 'card text',
        hintTarget: 'go',
        hintPresses: 0,
        hintReviewId: reviewId,
        swapData: null,
      },
    });

    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeCallbackUpdate(`hint:${reviewId}`, 576), {} as any);

    const answers = callApiSpy.mock.calls
      .filter(([method]: any[]) => method === 'answerCallbackQuery')
      .map(([, payload]: any[]) => String(payload?.text ?? ''));
    expect(answers).toContain(t('ru', 'worker.hintUnavailable'));
    expect(callApiSpy.mock.calls.some(([method]: any[]) => method === 'editMessageText')).toBe(false);

    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect((session?.payload as any)?.hintPresses).toBe(0);
  });

  it('WAITING_ANSWER text transitions to WAITING_GRADE', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    const created = await prisma.word.create({
      data: {
        userId: BigInt(userId),
        wordEn: 'hello',
        translationRu: 'привет',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
            userId: BigInt(userId),
            stage: 0,
            intervalMinutes: 5,
            nextReviewAt: new Date(Date.now() - 1000),
          },
        },
      },
      include: { reviews: true },
    });

    const sentAt = new Date();
    await setState(BigInt(userId), 'WAITING_ANSWER', {
      reviewId: created.reviews?.[0]?.id,
      wordId: created.id,
      direction: 'EN_TO_RU',
      sentAt,
      reminderStep: 0,
    });

    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeMessageUpdate('привет', 8), {} as any);

    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(session?.state).toBe('WAITING_GRADE');
    expect((session?.payload as any)?.correct).toBe(true);
    expect(session?.sentAt).not.toBeNull();
    expect(session?.sentAt?.getTime()).toBe(sentAt.getTime());
    expect(sentTexts(callApiSpy).some((text) => text.includes(t('ru', 'answer.pickGrade')))).toBe(true);
  });

  it('grade callback shows review flow button up to two times without url after initial pair', async () => {
    await prisma.user.create({
      data: {
        id: BigInt(userId),
        language: 'uz',
        maxNotificationsPerDay: 30,
      },
    });
    const createStageZeroPair = () =>
      prisma.word.create({
        data: {
          userId: BigInt(userId),
          wordEn: `word-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          translationRu: 'tarjima',
          reviews: {
            create: [
              {
                direction: 'EN_TO_RU',
                userId: BigInt(userId),
                stage: 1,
                intervalMinutes: 25,
                nextReviewAt: new Date(Date.now() + 25 * 60 * 1000),
                lastReviewAt: new Date(Date.now() - 60 * 1000),
              },
              {
                direction: 'RU_TO_EN',
                userId: BigInt(userId),
                stage: 0,
                intervalMinutes: 5,
                nextReviewAt: new Date(Date.now() - 1000),
              },
            ],
          },
        },
        include: { reviews: true },
      });

    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    const finishInitialPair = async (messageId: number) => {
      const word = await createStageZeroPair();
      const review = word.reviews.find((item) => item.direction === 'RU_TO_EN');
      expect(review).toBeTruthy();

      await setState(BigInt(userId), 'WAITING_GRADE', {
        reviewId: review!.id,
        wordId: word.id,
        direction: 'RU_TO_EN',
        sentAt: new Date(),
        answerText: 'word',
        payload: { correct: true },
      });

      await bot.handleUpdate(makeCallbackUpdate('grade:GOOD', messageId), {} as any);
      const editCall = callApiSpy.mock.calls.find(([method]: any[]) => method === 'editMessageText');
      const editPayload = editCall?.[1] as any;
      expect(String(editPayload?.text ?? '')).toContain(t('uz', 'grade.accepted'));
      callApiSpy.mockClear();
      return editPayload;
    };

    const firstEditPayload = await finishInitialPair(11);
    expect(String(firstEditPayload?.text ?? '')).not.toContain(t('uz', 'reviewFlowHint'));
    expect(firstEditPayload?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data).toBeUndefined();
    expect(firstEditPayload?.reply_markup?.inline_keyboard?.[0]?.[0]?.text).toContain(t('uz', 'btn.openGuide'));
    expect(firstEditPayload?.reply_markup?.inline_keyboard?.[0]?.[0]?.url).toBeUndefined();
    expect(firstEditPayload?.reply_markup?.inline_keyboard?.[0]?.[0]?.web_app?.url)
      .toBe('https://example.test/app?tab=settings&flow=stages');

    const userAfterFirstHint = await prisma.user.findUnique({ where: { id: BigInt(userId) } });
    expect(userAfterFirstHint?.reviewFlowHintShownAt).not.toBeNull();

    const secondEditPayload = await finishInitialPair(12);
    expect(secondEditPayload?.reply_markup?.inline_keyboard?.[0]?.[0]?.web_app?.url)
      .toBe('https://example.test/app?tab=settings&flow=stages');

    const thirdEditPayload = await finishInitialPair(13);
    expect(String(thirdEditPayload?.text ?? '')).not.toContain(t('uz', 'reviewFlowHint'));
    expect(thirdEditPayload?.reply_markup).toBeUndefined();

    const countRows = await prisma.$queryRaw<Array<{ reviewFlowHintShownCount: number }>>`
      SELECT "reviewFlowHintShownCount"
      FROM "User"
      WHERE "id" = ${BigInt(userId)}
    `;
    expect(Number(countRows[0]?.reviewFlowHintShownCount ?? -1)).toBe(2);
  });

  it('review flow hint button answers via callback alert without url', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'uz' } });
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeCallbackUpdate('review_flow_hint', 13), {} as any);

    const answerCbCall = callApiSpy.mock.calls.find(([method]: any[]) => method === 'answerCallbackQuery');
    expect(answerCbCall).toBeTruthy();
    expect(String((answerCbCall?.[1] as any)?.text ?? '')).toBe(t('uz', 'reviewFlowHint'));
    expect((answerCbCall?.[1] as any)?.show_alert).toBe(true);
  });

  it('grade callback immediately sends the second initial direction without waiting for interval', async () => {
    await prisma.user.create({
      data: {
        id: BigInt(userId),
        language: 'ru',
        notificationsEnabled: true,
        quietHoursStartMinutes: 0,
        quietHoursEndMinutes: 0,
        timezone: 'UTC',
        notificationIntervalMinutes: 60,
        lastNotificationAt: new Date(),
        maxNotificationsPerDay: 30,
      },
    });

    const word = await prisma.word.create({
      data: {
        userId: BigInt(userId),
        wordEn: 'bridge',
        translationRu: 'мост',
        reviews: {
          create: [
            {
              direction: 'EN_TO_RU',
              userId: BigInt(userId),
              initialAutoReviewPending: true,
              stage: 0,
              intervalMinutes: 5,
              nextReviewAt: new Date(Date.now() - 1000),
            },
            {
              direction: 'RU_TO_EN',
              userId: BigInt(userId),
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

    const firstReview = word.reviews.find((item) => item.direction === 'EN_TO_RU');
    const secondReview = word.reviews.find((item) => item.direction === 'RU_TO_EN');
    expect(firstReview).toBeTruthy();
    expect(secondReview).toBeTruthy();

    await setState(BigInt(userId), 'WAITING_GRADE', {
      reviewId: firstReview!.id,
      wordId: word.id,
      direction: 'EN_TO_RU',
      sentAt: new Date(),
      answerText: 'мост',
      payload: { correct: true },
    });

    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeCallbackUpdate('grade:GOOD', 21), {} as any);

    const sendCalls = callApiSpy.mock.calls.filter(([method]: any[]) => method === 'sendMessage');
    expect(sendCalls).toHaveLength(1);
    expect(String((sendCalls[0]?.[1] as any)?.text ?? '')).toContain('мост');

    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(session?.state).toBe('WAITING_ANSWER');
    expect(session?.reviewId).toBe(secondReview!.id);

    const updatedSecondReview = await prisma.review.findUnique({ where: { id: secondReview!.id } });
    expect(updatedSecondReview?.initialAutoReviewPending).toBe(false);
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

  it('grade callback rejects invalid rating without clearing active review session', async () => {
    await prisma.user.create({ data: { id: BigInt(userId), language: 'ru' } });
    const word = await prisma.word.create({
      data: {
        userId: BigInt(userId),
        wordEn: 'rating-check',
        translationRu: 'проверка',
        reviews: {
          create: [
            {
              direction: 'EN_TO_RU',
              userId: BigInt(userId),
              stage: 2,
              intervalMinutes: 90,
              nextReviewAt: new Date(Date.now() - 1000),
              lastReviewAt: new Date(Date.now() - 60_000),
            },
          ],
        },
      },
      include: { reviews: true },
    });
    const review = word.reviews[0];
    expect(review).toBeTruthy();

    await setState(BigInt(userId), 'WAITING_GRADE', {
      reviewId: review!.id,
      wordId: word.id,
      direction: 'EN_TO_RU',
      sentAt: new Date(),
      answerText: 'check',
      payload: { correct: true },
    });

    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeCallbackUpdate('grade:INVALID', 91), {} as any);

    const answerCbCall = callApiSpy.mock.calls.find(([method]: any[]) => method === 'answerCallbackQuery');
    expect(String((answerCbCall?.[1] as any)?.text ?? '')).toBe(t('ru', 'grade.noActive'));

    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(session?.state).toBe('WAITING_GRADE');
    expect(session?.reviewId).toBe(review!.id);
    expect((session?.payload as any)?.correct).toBe(true);

    const freshReview = await prisma.review.findUnique({ where: { id: review!.id } });
    expect(freshReview?.stage).toBe(2);
    expect(freshReview?.lastResult).toBeNull();
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

