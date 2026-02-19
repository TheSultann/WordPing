import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../src/generated/prisma';
import { prepareTestDatabase } from './helpers/testDb';
import { cleanupUserData } from './helpers/cleanup';
import { t } from '../src/i18n';

let bot: any;
let prisma: PrismaClient;

const userId = 900000003;

vi.mock('../src/services/translation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/translation')>();
  return {
    ...actual,
    suggestTranslation: vi.fn().mockResolvedValue(null),
  };
});

beforeAll(async () => {
  process.env.BOT_TOKEN = process.env.BOT_TOKEN ?? 'test_bot_token';
  process.env.WEBAPP_URL = 'https://example.test/app';

  const testUrl = await prepareTestDatabase();
  process.env.DATABASE_URL = testUrl;

  vi.resetModules();
  const mod = await import('../src/bot/index');
  bot = mod.bot;

  prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
});

beforeEach(async () => {
  await cleanupUserData(prisma, BigInt(userId));
  vi.restoreAllMocks();
});

afterAll(async () => {
  await cleanupUserData(prisma, BigInt(userId));
  await prisma?.$disconnect();
});

const makeMessageUpdate = (text: string, messageId = 1) => ({
  update_id: messageId,
  message: {
    message_id: messageId,
    date: Math.floor(Date.now() / 1000),
    text,
    entities: text.startsWith('/') ? [{ offset: 0, length: text.split(' ')[0]!.length, type: 'bot_command' }] : undefined,
    chat: { id: userId, type: 'private' },
    from: { id: userId, is_bot: false, first_name: 'Test' },
  },
});

describe('bot integration', () => {
  it('/app sends webapp button', async () => {
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeMessageUpdate('/app'), {} as any);

    const sendCall = callApiSpy.mock.calls.find(([method]) => method === 'sendMessage');
    expect(sendCall).toBeTruthy();
    const payload = sendCall?.[1] as any;
    const replyMarkup = payload?.reply_markup;
    expect(replyMarkup?.inline_keyboard?.[0]?.[0]?.web_app?.url).toBe('https://example.test/app');
  });

  it('/add flow saves word', async () => {
    vi.spyOn(Object.getPrototypeOf(bot.telegram), 'callApi').mockResolvedValue({} as any);

    await bot.handleUpdate(makeMessageUpdate('/add', 10), {} as any);
    await bot.handleUpdate(makeMessageUpdate('apple', 11), {} as any);
    await bot.handleUpdate(makeMessageUpdate('apple-ru', 12), {} as any);

    const word = await prisma.word.findFirst({ where: { userId: BigInt(userId) } });
    expect(word?.wordEn).toBe('apple');
    expect(word?.translationRu).toBe('apple-ru');
  });

  it('/add flow shows daily limit message after 9 words for regular user', async () => {
    const previousAdminIds = process.env.ADMIN_USER_IDS;
    const previousUnlimitedIds = process.env.UNLIMITED_WORD_ADD_IDS;
    const previousAdminTelegramId = process.env.ADMIN_TELEGRAM_ID;

    process.env.ADMIN_USER_IDS = '';
    process.env.UNLIMITED_WORD_ADD_IDS = '';
    process.env.ADMIN_TELEGRAM_ID = '';

    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    try {
      let messageId = 1000;
      for (let i = 1; i <= 10; i += 1) {
        await bot.handleUpdate(makeMessageUpdate('/add', messageId++), {} as any);
        await bot.handleUpdate(makeMessageUpdate(`word-${i}`, messageId++), {} as any);
        await bot.handleUpdate(makeMessageUpdate(`tr-${i}`, messageId++), {} as any);
      }

      const sendMessages = callApiSpy.mock.calls
        .filter(([method]) => method === 'sendMessage')
        .map(([, payload]) => String((payload as any)?.text ?? ''));

      const createdWords = await prisma.word.count({ where: { userId: BigInt(userId) } });
      expect(createdWords).toBe(9);
      expect(sendMessages).toContain(t('ru', 'add.dailyLimit', { limit: 9 }));
    } finally {
      process.env.ADMIN_USER_IDS = previousAdminIds;
      process.env.UNLIMITED_WORD_ADD_IDS = previousUnlimitedIds;
      process.env.ADMIN_TELEGRAM_ID = previousAdminTelegramId;
    }
  });
});
