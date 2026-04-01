import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '../src/generated/prisma/client';
import { prepareTestDatabase } from './helpers/testDb';
import { cleanupUserData } from './helpers/cleanup';
import { createRuntimeHealthReporter, readRuntimeHealth } from '../src/utils/runtimeHealth';

let app: any;
let prisma: PrismaClient;
const userId = BigInt(900000001);
const otherUserId = BigInt(900000010);
const seenUserId = BigInt(900000011);
const unseenUserId = BigInt(900000012);
const hugeUserId = BigInt('9007199254740993');
const runtimeHealthDir = path.join(process.cwd(), '.runtime', 'health');

const waitForRuntimeStatus = async (
  service: 'bot' | 'worker' | 'news-worker',
  status: 'ok' | 'error',
) => {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const health = await readRuntimeHealth([service]);
    if (health[service].status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${service} status ${status}`);
};

const waitForRuntimeDegraded = async (service: 'bot' | 'worker' | 'news-worker') => {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const health = await readRuntimeHealth([service]);
    if (health[service].status !== 'ok') return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${service} runtime degradation`);
};

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
  await cleanupUserData(prisma, seenUserId);
  await cleanupUserData(prisma, unseenUserId);
  await cleanupUserData(prisma, hugeUserId);

  createRuntimeHealthReporter('bot').markOk('bot ready for test');
  createRuntimeHealthReporter('worker').markOk('worker ready for test');
  createRuntimeHealthReporter('news-worker').markOk('news worker ready for test');
});

afterAll(async () => {
  await cleanupUserData(prisma, userId);
  await cleanupUserData(prisma, otherUserId);
  await cleanupUserData(prisma, seenUserId);
  await cleanupUserData(prisma, unseenUserId);
  await cleanupUserData(prisma, hugeUserId);
  await prisma?.$disconnect();
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

  it('does not authorize via DEV_USER_ID fallback without x-dev-user-id header', async () => {
    process.env.DEV_USER_ID = userId.toString();
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(401);
  });

  it('GET /api/health', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.runtimeOk).toEqual(expect.any(Boolean));
    expect(res.body.database).toEqual({ ok: true });
    expect(res.body.services.api).toMatchObject({
      service: 'api',
      status: expect.any(String),
      stale: expect.any(Boolean),
    });
    expect(res.body.services.bot).toMatchObject({
      service: 'bot',
      status: expect.any(String),
      stale: expect.any(Boolean),
    });
    expect(res.body.services.worker).toMatchObject({
      service: 'worker',
      status: expect.any(String),
      stale: expect.any(Boolean),
    });
    expect(res.body.services['news-worker']).toMatchObject({
      service: 'news-worker',
      status: expect.any(String),
      stale: expect.any(Boolean),
    });
  });

  it('GET /api/health returns 503 in production when runtime services are degraded', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      createRuntimeHealthReporter('worker').markError('worker failed');
      await waitForRuntimeDegraded('worker');

      const res = await request(app).get('/api/health');
      expect(res.status).toBe(503);
      expect(res.body.ok).toBe(false);
      expect(res.body.runtimeOk).toBe(false);
      expect(res.body.services.worker.status).not.toBe('ok');
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      createRuntimeHealthReporter('worker').markOk('worker restored');
    }
  });

  it('GET /api/ready returns 200 when background worker heartbeat is fresh even after task error', async () => {
    createRuntimeHealthReporter('worker').markError('worker failed');
    await waitForRuntimeDegraded('worker');

    const res = await request(app).get('/api/ready');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.runtimeReady).toBe(true);
    expect(res.body.services.worker.status).toBe('error');
  });

  it('GET /api/ready returns 503 when runtime heartbeat is stale', async () => {
    await waitForRuntimeStatus('worker', 'ok');
    await writeFile(
      path.join(runtimeHealthDir, 'worker.json'),
      JSON.stringify({
        service: 'worker',
        pid: 123,
        startedAt: '2026-03-28T00:00:00.000Z',
        updatedAt: '2026-03-28T00:00:00.000Z',
        state: 'ok',
      }, null, 2),
      'utf8',
    );

    const res = await request(app).get('/api/ready');
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.runtimeReady).toBe(false);
    expect(res.body.services.worker.status).toBe('stale');
  });

  it('GET /api/ready returns 503 when worker error heartbeat is stale', async () => {
    await waitForRuntimeStatus('worker', 'ok');
    await writeFile(
      path.join(runtimeHealthDir, 'worker.json'),
      JSON.stringify({
        service: 'worker',
        pid: 123,
        startedAt: '2026-03-28T00:00:00.000Z',
        updatedAt: '2026-03-28T00:00:00.000Z',
        state: 'error',
        note: 'worker failed',
      }, null, 2),
      'utf8',
    );

    const res = await request(app).get('/api/ready');
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.runtimeReady).toBe(false);
    expect(res.body.services.worker.status).toBe('error');
    expect(res.body.services.worker.stale).toBe(true);
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

  it('persists timezone from x-timezone header', async () => {
    const res = await request(app)
      .get('/api/me')
      .set('x-dev-user-id', userId.toString())
      .set('x-timezone', 'Asia/Tashkent');

    expect(res.status).toBe(200);
    expect(res.body.timezone).toBe('Asia/Tashkent');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.timezone).toBe('Asia/Tashkent');
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
    expect(res.body.wordsTotal).toBeDefined();
    expect(res.body.learnedTotal).toBeDefined();
    expect(res.body.dueTodayCount).toBeDefined();
    expect(res.body.dueNowTotal).toBeDefined();
    expect(res.body.accuracyTodayPercent).toBeDefined();
    expect(res.body.notificationsSentToday).toBeDefined();
    expect(res.body.dailyLimit).toBeDefined();
  });

  it('GET /api/stats returns accuracyTodayPercent from daily counters', async () => {
    await prisma.user.create({
      data: {
        id: userId,
        doneTodayCount: 5,
        correctTodayCount: 4,
        lastDoneDate: new Date(),
      },
    });

    const res = await request(app)
      .get('/api/stats')
      .set('x-dev-user-id', userId.toString());
    expect(res.status).toBe(200);
    expect(res.body.doneTodayCount).toBe(5);
    expect(res.body.accuracyTodayPercent).toBe(80);
  });

  it('GET /api/stats counts dueToday by words, not by review directions', async () => {
    await prisma.user.create({ data: { id: userId } });
    await prisma.word.create({
      data: {
        userId,
        wordEn: 'hello',
        translationRu: 'привет',
        reviews: {
          create: [
            {
              direction: 'EN_TO_RU',
              userId,
              stage: 0,
              intervalMinutes: 5,
              nextReviewAt: new Date(),
            },
            {
              direction: 'RU_TO_EN',
              userId,
              stage: 0,
              intervalMinutes: 5,
              nextReviewAt: new Date(),
            },
          ],
        },
      },
    });

    const res = await request(app)
      .get('/api/stats')
      .set('x-dev-user-id', userId.toString());
    expect(res.status).toBe(200);
    expect(res.body.wordsTotal).toBe(1);
    expect(res.body.dueTodayCount).toBe(1);
    expect(res.body.dueNowTotal).toBe(1);
  });

  it('GET /api/stats separates dueNowTotal from dueTodayCount', async () => {
    await prisma.user.create({ data: { id: userId } });
    await prisma.word.create({
      data: {
        userId,
        wordEn: 'overdue',
        translationRu: 'просрочено',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
            userId,
            stage: 1,
            intervalMinutes: 10,
            nextReviewAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
      },
    });

    const res = await request(app)
      .get('/api/stats')
      .set('x-dev-user-id', userId.toString());
    expect(res.status).toBe(200);
    expect(res.body.dueNowTotal).toBe(1);
    expect(res.body.dueTodayCount).toBe(0);
  });

  it('GET /api/stats returns learnedTotal based on stage >= 4', async () => {
    await prisma.user.create({ data: { id: userId } });
    await prisma.word.create({
      data: {
        userId,
        wordEn: 'learned',
        translationRu: 'выучено',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
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
        reviews: {
          create: {
            direction: 'EN_TO_RU',
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
    expect(res.body.learnedTotal).toBe(1);
    expect(res.body.dueNowTotal).toBe(1);
  });

  it('GET /api/stats excludes learned words from dueNowTotal', async () => {
    await prisma.user.create({ data: { id: userId } });
    await prisma.word.create({
      data: {
        userId,
        wordEn: 'mastered',
        translationRu: 'выучено',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
            userId,
            stage: 4,
            intervalMinutes: 4320,
            nextReviewAt: new Date(),
          },
        },
      },
    });

    const res = await request(app)
      .get('/api/stats')
      .set('x-dev-user-id', userId.toString());
    expect(res.status).toBe(200);
    expect(res.body.wordsTotal).toBe(1);
    expect(res.body.learnedTotal).toBe(1);
    expect(res.body.dueNowTotal).toBe(0);
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
        reviews: {
          create: {
            direction: 'EN_TO_RU',
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
    expect(list.body.hasMore).toBe(false);

    const filtered = await request(app)
      .get('/api/words?q=app')
      .set('x-dev-user-id', userId.toString());
    expect(filtered.status).toBe(200);
    expect(filtered.body.items.length).toBe(1);
    expect(filtered.body.hasMore).toBe(false);

    const del = await request(app)
      .delete(`/api/words/${created.id}`)
      .set('x-dev-user-id', userId.toString());
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);

    const listAfter = await request(app)
      .get('/api/words')
      .set('x-dev-user-id', userId.toString());
    expect(listAfter.body.items.length).toBe(0);
    expect(listAfter.body.hasMore).toBe(false);
  });

  it('DELETE /api/words/:id resets active session when deleted word is open in review', async () => {
    await prisma.user.create({ data: { id: userId } });
    const created = await prisma.word.create({
      data: {
        userId,
        wordEn: 'active-delete',
        translationRu: 'активное удаление',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
            userId,
            stage: 2,
            intervalMinutes: 30,
            nextReviewAt: new Date(),
          },
        },
      },
      include: { reviews: true },
    });

    await prisma.userSession.create({
      data: {
        userId,
        state: 'WAITING_ANSWER',
        reviewId: created.reviews[0]!.id,
        wordId: created.id,
        direction: 'EN_TO_RU',
        sentAt: new Date(),
        reminderStep: 0,
      },
    });

    const del = await request(app)
      .delete(`/api/words/${created.id}`)
      .set('x-dev-user-id', userId.toString());

    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);

    const session = await prisma.userSession.findUnique({ where: { userId } });
    expect(session?.state).toBe('IDLE');
    expect(session?.reviewId).toBeNull();
    expect(session?.wordId).toBeNull();
    expect(session?.direction).toBeNull();
  });

  it('DELETE /api/words/:id rejects non-integer ids', async () => {
    const badIds = ['12.5', '0', '-1', 'abc'];

    for (const badId of badIds) {
      const res = await request(app)
        .delete(`/api/words/${badId}`)
        .set('x-dev-user-id', userId.toString());
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_id');
    }
  });

  it('GET /api/words supports limit+offset pagination', async () => {
    await prisma.user.create({ data: { id: userId } });
    for (let index = 0; index < 26; index += 1) {
      await prisma.word.create({
        data: {
          userId,
          wordEn: `word-${index}`,
          translationRu: `слово-${index}`,
          reviews: {
            create: {
              direction: 'EN_TO_RU',
              userId,
              stage: 0,
              intervalMinutes: 5,
              nextReviewAt: new Date(),
            },
          },
        },
      });
    }

    const firstPage = await request(app)
      .get('/api/words?limit=25&offset=0')
      .set('x-dev-user-id', userId.toString());
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.items.length).toBe(25);
    expect(firstPage.body.hasMore).toBe(true);

    const secondPage = await request(app)
      .get('/api/words?limit=25&offset=25')
      .set('x-dev-user-id', userId.toString());
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.items.length).toBe(1);
    expect(secondPage.body.hasMore).toBe(false);

    const firstIds = new Set<number>((firstPage.body.items as Array<{ id: number }>).map((item) => item.id));
    const secondIds = new Set<number>((secondPage.body.items as Array<{ id: number }>).map((item) => item.id));
    const intersection = [...secondIds].filter((id) => firstIds.has(id));
    expect(intersection.length).toBe(0);
  });

  it('GET /api/admin/overview returns learned and postponed counts', async () => {
    await prisma.user.create({ data: { id: userId } });
    await prisma.word.create({
      data: {
        userId,
        wordEn: 'alpha',
        translationRu: 'альфа',
        reviews: {
          create: {
            direction: 'EN_TO_RU',
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
        reviews: {
          create: {
            direction: 'EN_TO_RU',
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
        reviews: {
          create: {
            direction: 'EN_TO_RU',
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

  it('GET /api/admin/users supports search by id, username and name', async () => {
    await prisma.user.create({
      data: {
        id: userId,
        tgFirstName: 'Sultan',
        tgLastName: 'Admin',
        tgUsername: 'sultan_admin',
      },
    });

    const byName = await request(app)
      .get('/api/admin/users?q=sultan')
      .set('x-dev-user-id', userId.toString());
    expect(byName.status).toBe(200);
    expect(Array.isArray(byName.body.items)).toBe(true);
    expect(byName.body.items.some((item: any) => item.id === userId.toString())).toBe(true);

    const byUsername = await request(app)
      .get('/api/admin/users?q=@sultan_admin')
      .set('x-dev-user-id', userId.toString());
    expect(byUsername.status).toBe(200);
    expect(byUsername.body.items.some((item: any) => item.id === userId.toString())).toBe(true);

    const byId = await request(app)
      .get(`/api/admin/users?q=${userId.toString()}`)
      .set('x-dev-user-id', userId.toString());
    expect(byId.status).toBe(200);
    expect(byId.body.items.some((item: any) => item.id === userId.toString())).toBe(true);
  });

  it('GET /api/admin/users sorts users by registration date (newest first)', async () => {
    await prisma.user.create({
      data: {
        id: seenUserId,
        tgUsername: 'p2sort_seen',
        createdAt: new Date('2026-01-10T00:00:00.000Z'),
      },
    });
    await prisma.user.create({
      data: {
        id: unseenUserId,
        tgUsername: 'p2sort_unseen',
        createdAt: new Date('2026-01-11T00:00:00.000Z'),
      },
    });

    const res = await request(app)
      .get('/api/admin/users?q=p2sort')
      .set('x-dev-user-id', userId.toString());

    expect(res.status).toBe(200);
    const ids = (res.body.items as Array<{ id: string }>).map((item) => item.id);
    const seenIndex = ids.indexOf(seenUserId.toString());
    const unseenIndex = ids.indexOf(unseenUserId.toString());
    expect(seenIndex).toBeGreaterThanOrEqual(0);
    expect(unseenIndex).toBeGreaterThanOrEqual(0);
    expect(unseenIndex).toBeLessThan(seenIndex);
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

  it('GET /api/admin/users/:id handles ids larger than Number.MAX_SAFE_INTEGER', async () => {
    await prisma.user.create({
      data: {
        id: hugeUserId,
        tgUsername: 'huge-id-user',
      },
    });

    const res = await request(app)
      .get(`/api/admin/users/${hugeUserId.toString()}`)
      .set('x-dev-user-id', userId.toString());

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(hugeUserId.toString());
    expect(res.body.tgUsername).toBe('huge-id-user');
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

  it('POST /api/admin/broadcast retries after Telegram 429 with retry_after', async () => {
    await prisma.user.create({ data: { id: userId } });

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () =>
          JSON.stringify({
            ok: false,
            error_code: 429,
            description: 'Too Many Requests',
            parameters: { retry_after: 1 },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '',
      });
    vi.stubGlobal('fetch', fetchSpy as any);

    const res = await request(app)
      .post('/api/admin/broadcast')
      .set('x-dev-user-id', userId.toString())
      .send({ message: 'retry me' });

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(1);
    expect(res.body.failed).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
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
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('quiet_hours_span_too_short');
    expect(res.body.minSpanMinutes).toBe(480);

    const settings = await request(app)
      .get('/api/settings')
      .set('x-dev-user-id', userId.toString());
    expect(settings.status).toBe(200);
    expect(settings.body.quietHoursStartMinutes).toBe(480);
    expect(settings.body.quietHoursEndMinutes).toBe(1380);
  });
});
