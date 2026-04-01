import { rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prepareTestDatabase } from './helpers/testDb';
import { readRuntimeHealth } from '../src/utils/runtimeHealth';

const runtimeDir = path.join(process.cwd(), '.runtime');

const waitForBotHealth = async (predicate: (snapshot: Awaited<ReturnType<typeof readRuntimeHealth>>['bot']) => boolean) => {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const health = await readRuntimeHealth(['bot']);
    if (predicate(health.bot)) return health.bot;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error('Timed out waiting for bot health state');
};

beforeAll(async () => {
  process.env.BOT_TOKEN = process.env.BOT_TOKEN ?? 'test_bot_token';
  process.env.WEBAPP_URL = 'https://example.test/app';
  process.env.DATABASE_URL = await prepareTestDatabase();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(runtimeDir, { recursive: true, force: true });
  const { prisma } = await import('../src/db/client');
  await prisma.$disconnect();
});

describe('bot startup', () => {
  it('keeps bot unhealthy until launch resolves and marks it healthy afterwards', async () => {
    vi.resetModules();
    const mod = await import('../src/bot/index');
    let resolveLaunch!: () => void;
    const launchPromise = new Promise<void>((resolve) => {
      resolveLaunch = resolve;
    });

    vi.spyOn(process, 'once').mockImplementation((() => process) as any);
    vi.spyOn(mod.bot, 'launch').mockReturnValue(launchPromise as any);

    const startPromise = mod.startBot();

    const startingHealth = await waitForBotHealth((snapshot) =>
      snapshot.status === 'error' && snapshot.note === 'bot starting');
    expect(startingHealth.stale).toBe(false);

    resolveLaunch();
    await startPromise;

    const readyHealth = await waitForBotHealth((snapshot) =>
      snapshot.status === 'ok' && snapshot.note === 'bot launched');
    expect(readyHealth.stale).toBe(false);
  });

  it('marks bot unhealthy and rejects startup when launch fails', async () => {
    vi.resetModules();
    const mod = await import('../src/bot/index');
    const launchError = new Error('bad token');

    vi.spyOn(process, 'once').mockImplementation((() => process) as any);
    vi.spyOn(mod.bot, 'launch').mockRejectedValue(launchError);

    await expect(mod.startBot()).rejects.toThrow('bad token');

    const failedHealth = await waitForBotHealth((snapshot) =>
      snapshot.status === 'error' && snapshot.note === 'bad token');
    expect(failedHealth.stale).toBe(false);
  });
});
