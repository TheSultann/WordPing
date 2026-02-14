import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../src/generated/prisma';
import { prepareTestDatabase } from './helpers/testDb';
import { cleanupUserData } from './helpers/cleanup';

let prisma: PrismaClient;
let ensureSession: (userId: bigint) => Promise<any>;
let getSession: (userId: bigint) => Promise<any>;
let setState: (userId: bigint, state: any, data?: any) => Promise<any>;
let setSessionActiveIfIdle: (userId: bigint, state: any, data?: any) => Promise<boolean>;
let resetState: (userId: bigint) => Promise<any>;

const userId = BigInt(900000014);

beforeAll(async () => {
  const testUrl = await prepareTestDatabase();
  process.env.DATABASE_URL = testUrl;

  vi.resetModules();
  const mod = await import('../src/services/sessionService');

  ensureSession = mod.ensureSession;
  getSession = mod.getSession;
  setState = mod.setState;
  setSessionActiveIfIdle = mod.setSessionActiveIfIdle;
  resetState = mod.resetState;

  prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
});

beforeEach(async () => {
  await cleanupUserData(prisma, userId);
  await prisma.user.create({ data: { id: userId } });
});

afterAll(async () => {
  await cleanupUserData(prisma, userId);
  await prisma?.$disconnect();
});

describe('sessionService integration', () => {
  it('ensureSession creates IDLE session and getSession returns it', async () => {
    const created = await ensureSession(userId);
    const loaded = await getSession(userId);

    expect(created.userId.toString()).toBe(userId.toString());
    expect(created.state).toBe('IDLE');
    expect(loaded.userId.toString()).toBe(userId.toString());
    expect(loaded.state).toBe('IDLE');
  });

  it('setState preserves language from existing payload', async () => {
    await setState(userId, 'IDLE', { payload: { lang: 'uz', step: 'one' } });
    const updated = await setState(userId, 'WAITING_ANSWER', {
      reviewId: 42,
      payload: { step: 'two' },
    });

    const payload = (updated.payload ?? {}) as Record<string, unknown>;
    expect(updated.state).toBe('WAITING_ANSWER');
    expect(updated.reviewId).toBe(42);
    expect(payload.lang).toBe('uz');
    expect(payload.step).toBe('two');
  });

  it('setSessionActiveIfIdle updates once and keeps lang', async () => {
    await setState(userId, 'IDLE', { payload: { lang: 'ru' } });

    const first = await setSessionActiveIfIdle(userId, 'WAITING_GRADE', {
      reviewId: 100,
      payload: { attempt: 1 },
    });
    const second = await setSessionActiveIfIdle(userId, 'ADDING_WORD_WAIT_EN');

    const current = await getSession(userId);
    const payload = (current.payload ?? {}) as Record<string, unknown>;

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(current.state).toBe('WAITING_GRADE');
    expect(current.reviewId).toBe(100);
    expect(payload.lang).toBe('ru');
    expect(payload.attempt).toBe(1);
  });

  it('resetState clears active fields and keeps only lang payload', async () => {
    await setState(userId, 'WAITING_ANSWER', {
      reviewId: 77,
      wordId: 55,
      reminderStep: 3,
      answerText: 'test',
      payload: { lang: 'uz', temp: 'value' },
    });

    const reset = await resetState(userId);
    const payload = reset.payload as Record<string, unknown> | null;

    expect(reset.state).toBe('IDLE');
    expect(reset.reviewId).toBeNull();
    expect(reset.wordId).toBeNull();
    expect(reset.reminderStep).toBe(0);
    expect(reset.answerText).toBeNull();
    expect(payload).toEqual({ lang: 'uz' });
  });
});
