import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../src/generated/prisma';
import { prepareTestDatabase } from './helpers/testDb';
import { cleanupUserData } from './helpers/cleanup';

let bot: any;
let prisma: PrismaClient;

const userId = 900000016;

const makeMessageUpdate = (text: string, messageId = 1) => ({
  update_id: messageId,
  message: {
    message_id: messageId,
    date: Math.floor(Date.now() / 1000),
    text,
    entities: text.startsWith('/') ? [{ offset: 0, length: text.split(' ')[0]!.length, type: 'bot_command' }] : undefined,
    chat: { id: userId, type: 'private' },
    from: { id: userId, is_bot: false, first_name: 'NoWebApp' },
  },
});

beforeAll(async () => {
  process.env.BOT_TOKEN = process.env.BOT_TOKEN ?? 'test_bot_token';
  delete process.env.WEBAPP_URL;

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

describe('bot without webapp url', () => {
  it('returns explicit message for app/settings/stats commands', async () => {
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeMessageUpdate('/app', 1), {} as any);
    await bot.handleUpdate(makeMessageUpdate('/settings', 2), {} as any);
    await bot.handleUpdate(makeMessageUpdate('/stats', 3), {} as any);

    const texts = callApiSpy.mock.calls
      .filter(([method]) => method === 'sendMessage')
      .map(([, payload]) => String((payload as any)?.text ?? ''));

    expect(texts).toContain('WEBAPP_URL is not set');
    expect(texts.length).toBeGreaterThanOrEqual(3);
  });
});
