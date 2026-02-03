import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '../src/generated/prisma';
import { prepareTestDatabase } from './helpers/testDb';
import { cleanupUserData } from './helpers/cleanup';

let app: any;
let prisma: PrismaClient;
const userId = BigInt(900000001);

beforeAll(async () => {
  const testUrl = await prepareTestDatabase();
  process.env.DATABASE_URL = testUrl;
  process.env.ALLOW_DEV_AUTH = 'true';
  process.env.NODE_ENV = 'development';

  const mod = await import('../src/api/index');
  app = mod.app;
  prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
});

beforeEach(async () => {
  await cleanupUserData(prisma, userId);
});

afterAll(async () => {
  await cleanupUserData(prisma, userId);
  await prisma.$disconnect();
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
});
