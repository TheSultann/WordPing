import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '../src/generated/prisma';
import { prepareTestDatabase } from './helpers/testDb';
import { cleanupUserData } from './helpers/cleanup';

let app: any;
let prisma: PrismaClient;
const userId = BigInt(900000001);
const otherUserId = BigInt(900000010);

beforeAll(async () => {
  const testUrl = await prepareTestDatabase();
  process.env.DATABASE_URL = testUrl;
  process.env.ALLOW_DEV_AUTH = 'true';
  process.env.NODE_ENV = 'development';
  process.env.ADMIN_TELEGRAM_ID = userId.toString();
  process.env.BOT_TOKEN = 'test-token';

  vi.resetModules();
  const mod = await import('../src/api/index');
  app = mod.app;
  prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
});

beforeEach(async () => {
  await cleanupUserData(prisma, userId);
  await cleanupUserData(prisma, otherUserId);
});

afterAll(async () => {
  await cleanupUserData(prisma, userId);
  await cleanupUserData(prisma, otherUserId);
  await prisma.$disconnect();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('API integration', () => {
  it('rejects requests without auth', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(401);
  });

  it('GET /api/health', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET /api/settings returns defaults', async () => {
    const res = await request(app)
      .get('/api/settings')
      .set('x-dev-user-id', userId.toString());
    expect(res.status).toBe(200);
    expect(res.body.notificationsEnabled).toBe(true);
    expect(res.body.notificationIntervalMinutes).toBe(30);
    expect(res.body.maxNotificationsPerDay).toBe(20);
  });

  it('PATCH /api/settings updates values', async () => {
    const res = await request(app)
      .patch('/api/settings')
      .set('x-dev-user-id', userId.toString())
      .send({
        notificationsEnabled: false,
        notificationIntervalMinutes: 45,
        maxNotificationsPerDay: 10,
        quietHoursStartMinutes: 600,
        quietHoursEndMinutes: 1200,
      });
    expect(res.status).toBe(200);
    expect(res.body.notificationsEnabled).toBe(false);
    expect(res.body.notificationIntervalMinutes).toBe(45);
    expect(res.body.maxNotificationsPerDay).toBe(10);
    expect(res.body.quietHoursStartMinutes).toBe(600);
    expect(res.body.quietHoursEndMinutes).toBe(1200);
  });

  it('GET /api/stats returns counters', async () => {
    const res = await request(app)
      .get('/api/stats')
      .set('x-dev-user-id', userId.toString());
    expect(res.status).toBe(200);
    expect(res.body.words).toBeDefined();
    expect(res.body.dueToday).toBeDefined();
    expect(res.body.dailyLimit).toBeDefined();
  });

  it('GET /api/stats returns learnedCount based on stage >= 4', async () => {
    await prisma.user.create({ data: { id: userId } });
    await prisma.word.create({
      data: {
        userId,
        wordEn: 'learned',
        translationRu: 'выучено',
        review: {
          create: {
            userId,
            stage: 4,
            intervalMinutes: 4320,
            nextReviewAt: new Date(),
          },
        },
      },
    });
    await prisma.word.create({
      data: {
        userId,
        wordEn: 'notyet',
        translationRu: 'не',
        review: {
          create: {
            userId,
            stage: 3,
            intervalMinutes: 1440,
            nextReviewAt: new Date(),
          },
        },
      },
    });

    const res = await request(app)
      .get('/api/stats')
      .set('x-dev-user-id', userId.toString());
    expect(res.status).toBe(200);
    expect(res.body.learnedCount).toBe(1);
  });

  it('GET /api/admin/overview rejects non-admin', async () => {
    const res = await request(app)
      .get('/api/admin/overview')
      .set('x-dev-user-id', otherUserId.toString());
    expect(res.status).toBe(403);
  });

  it('POST /api/admin/broadcast rejects non-admin', async () => {
    const res = await request(app)
      .post('/api/admin/broadcast')
      .set('x-dev-user-id', otherUserId.toString())
      .send({ message: 'hello' });
    expect(res.status).toBe(403);
  });

  it('GET /api/words and DELETE /api/words/:id', async () => {
    await prisma.user.create({ data: { id: userId } });
    const created = await prisma.word.create({
      data: {
        userId,
        wordEn: 'apple',
        translationRu: 'яблоко',
        review: {
          create: {
            userId,
            stage: 0,
            intervalMinutes: 5,
            nextReviewAt: new Date(),
          },
        },
      },
    });

    const list = await request(app)
      .get('/api/words')
      .set('x-dev-user-id', userId.toString());
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBe(1);
    expect(list.body.items[0].wordEn).toBe('apple');

    const filtered = await request(app)
      .get('/api/words?q=app')
      .set('x-dev-user-id', userId.toString());
    expect(filtered.status).toBe(200);
    expect(filtered.body.items.length).toBe(1);

    const del = await request(app)
      .delete(`/api/words/${created.id}`)
      .set('x-dev-user-id', userId.toString());
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);

    const listAfter = await request(app)
      .get('/api/words')
      .set('x-dev-user-id', userId.toString());
    expect(listAfter.body.items.length).toBe(0);
  });

  it('GET /api/admin/overview returns learned and postponed counts', async () => {
    await prisma.user.create({ data: { id: userId } });
    await prisma.word.create({
      data: {
        userId,
        wordEn: 'alpha',
        translationRu: 'альфа',
        review: {
          create: {
            userId,
            stage: 4,
            intervalMinutes: 4320,
            nextReviewAt: new Date(),
            lastResult: 'CORRECT',
          },
        },
      },
    });
    await prisma.word.create({
      data: {
        userId,
        wordEn: 'beta',
        translationRu: 'бета',
        review: {
          create: {
            userId,
            stage: 0,
            intervalMinutes: 5,
            nextReviewAt: new Date(),
            lastResult: 'SKIPPED',
          },
        },
      },
    });

    const res = await request(app)
      .get('/api/admin/overview')
      .set('x-dev-user-id', userId.toString());

    expect(res.status).toBe(200);
    const row = res.body.recentUsers.find((item: any) => item.id === userId.toString());
    expect(row).toBeTruthy();
    expect(row.wordsCount).toBe(2);
    expect(row.learnedCount).toBe(1);
    expect(row.postponedCount).toBe(1);
  });

  it('GET /api/admin/users/:id returns counts', async () => {
    await prisma.user.create({ data: { id: userId } });
    await prisma.word.create({
      data: {
        userId,
        wordEn: 'gamma',
        translationRu: 'гамма',
        review: {
          create: {
            userId,
            stage: 4,
            intervalMinutes: 4320,
            nextReviewAt: new Date(),
          },
        },
      },
    });

    const res = await request(app)
      .get(`/api/admin/users/${userId.toString()}`)
      .set('x-dev-user-id', userId.toString());
    expect(res.status).toBe(200);
    expect(res.body.wordsCount).toBe(1);
    expect(res.body.learnedCount).toBe(1);
  });

  it('GET /api/admin/users/:id validates id and 404', async () => {
    const resInvalid = await request(app)
      .get('/api/admin/users/abc')
      .set('x-dev-user-id', userId.toString());
    expect(resInvalid.status).toBe(400);

    const resMissing = await request(app)
      .get('/api/admin/users/999999999')
      .set('x-dev-user-id', userId.toString());
    expect(resMissing.status).toBe(404);
  });

  it('POST /api/admin/broadcast sends message to all users', async () => {
    await prisma.user.create({ data: { id: userId } });
    await prisma.user.create({ data: { id: otherUserId } });

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchSpy as any);

    const res = await request(app)
      .post('/api/admin/broadcast')
      .set('x-dev-user-id', userId.toString())
      .send({ message: 'Hello all' });

    expect(res.status).toBe(200);
    expect(res.body.sent).toBeGreaterThanOrEqual(2);
    expect(fetchSpy).toHaveBeenCalledTimes(res.body.sent);
    const firstUrl = fetchSpy.mock.calls[0][0] as string;
    expect(firstUrl).toContain('/sendMessage');

    const sentIds = fetchSpy.mock.calls.map(([, init]) => {
      const body = JSON.parse(String((init as any)?.body ?? '{}'));
      return String(body.chat_id);
    });
    expect(sentIds).toContain(userId.toString());
    expect(sentIds).toContain(otherUserId.toString());
  });

  it('POST /api/admin/broadcast sends photo with caption', async () => {
    await prisma.user.create({ data: { id: userId } });

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchSpy as any);

    const res = await request(app)
      .post('/api/admin/broadcast')
      .set('x-dev-user-id', userId.toString())
      .send({ message: 'Caption', photoUrl: 'https://example.com/photo.jpg' });

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const firstUrl = fetchSpy.mock.calls[0][0] as string;
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(firstUrl).toContain('/sendPhoto');
    expect(body.photo).toBe('https://example.com/photo.jpg');
    expect(body.caption).toBe('Caption');
  });

  it('POST /api/admin/broadcast sends photo without caption', async () => {
    await prisma.user.create({ data: { id: userId } });

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchSpy as any);

    const res = await request(app)
      .post('/api/admin/broadcast')
      .set('x-dev-user-id', userId.toString())
      .send({ message: '', photoUrl: 'https://example.com/photo.jpg' });

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const firstUrl = fetchSpy.mock.calls[0][0] as string;
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(firstUrl).toContain('/sendPhoto');
    expect(body.caption).toBeUndefined();
  });

  it('POST /api/admin/broadcast validates payload', async () => {
    const resEmpty = await request(app)
      .post('/api/admin/broadcast')
      .set('x-dev-user-id', userId.toString())
      .send({});
    expect(resEmpty.status).toBe(400);
    expect(resEmpty.body.error).toBe('empty_message');

    const tooLongMessage = 'x'.repeat(4001);
    const resTooLong = await request(app)
      .post('/api/admin/broadcast')
      .set('x-dev-user-id', userId.toString())
      .send({ message: tooLongMessage });
    expect(resTooLong.status).toBe(400);
    expect(resTooLong.body.error).toBe('message_too_long');

    const captionTooLong = 'x'.repeat(1025);
    const resCaption = await request(app)
      .post('/api/admin/broadcast')
      .set('x-dev-user-id', userId.toString())
      .send({ message: captionTooLong, photoUrl: 'https://example.com/photo.jpg' });
    expect(resCaption.status).toBe(400);
    expect(resCaption.body.error).toBe('caption_too_long');
  });

  it('PATCH /api/settings clamps out-of-range values', async () => {
    const res = await request(app)
      .patch('/api/settings')
      .set('x-dev-user-id', userId.toString())
      .send({
        notificationIntervalMinutes: 9999,
        maxNotificationsPerDay: -5,
      });
    expect(res.status).toBe(200);
    expect(res.body.notificationIntervalMinutes).toBe(240);
    expect(res.body.maxNotificationsPerDay).toBe(5);
  });

  it('PATCH /api/settings enforces quiet hours min span', async () => {
    const res = await request(app)
      .patch('/api/settings')
      .set('x-dev-user-id', userId.toString())
      .send({
        quietHoursStartMinutes: 600,
        quietHoursEndMinutes: 650,
      });
    expect(res.status).toBe(200);
    expect(res.body.quietHoursStartMinutes).toBe(600);
    expect(res.body.quietHoursEndMinutes).toBe(1080);
  });
});
