import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../src/generated/prisma';
import { prepareTestDatabase } from './helpers/testDb';

let prisma: PrismaClient;
let tick: () => Promise<void>;

beforeAll(async () => {
  process.env.BOT_TOKEN = process.env.BOT_TOKEN ?? 'test_bot_token';
  const testUrl = await prepareTestDatabase();
  process.env.DATABASE_URL = testUrl;

  vi.resetModules();
  const mod = await import('../src/scheduler/worker');
  tick = mod.tick;

  prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
});

beforeEach(async () => {
  await prisma.review.deleteMany({});
  await prisma.word.deleteMany({});
  await prisma.userSession.deleteMany({});
  await prisma.user.deleteMany({});
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('uvd worker tick isolation', () => {
  it('does not perform external fetch calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await tick();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

