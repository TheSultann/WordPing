import 'dotenv/config';
import express, { type RequestHandler } from 'express';
import cors from 'cors';
import { prisma } from '../db/client';
import { Prisma } from '../generated/prisma';
import {
  countDueToday,
  countUserWords,
  ensureUser,
  resetProgressIfNeeded,
  setLanguage,
  setNotificationInterval,
  setNotificationLimit,
  setNotifications,
  setQuietHours,
  countReferrals,
  MIN_NOTIFICATION_INTERVAL,
  MAX_NOTIFICATION_INTERVAL,
  MIN_NOTIFICATIONS_PER_DAY,
  MAX_NOTIFICATIONS_PER_DAY,
} from '../services/userService';
import { nowUtc, startOfUserDay, userNow } from '../utils/time';
import { verifyInitData } from './auth';

export const app = express();

const parseOrigins = (value?: string) =>
  (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

const defaultOrigins = process.env.NODE_ENV === 'production'
  ? []
  : ['http://localhost:5173', 'http://127.0.0.1:5173'];

const allowedOrigins = Array.from(new Set([...parseOrigins(process.env.WEB_ORIGIN), ...defaultOrigins]));

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0) {
        return callback(new Error('CORS blocked'));
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('CORS blocked'));
    },
    credentials: true,
  })
);

app.use(express.json());

const botToken = process.env.BOT_TOKEN ?? '';
const maxAgeSeconds = parseInt(process.env.INIT_DATA_MAX_AGE_SECONDS ?? '86400', 10);
const allowDev = process.env.NODE_ENV === 'development' || process.env.ALLOW_DEV_AUTH === 'true';
const devUserId = process.env.DEV_USER_ID;
const adminTelegramId = (() => {
  const raw = (process.env.ADMIN_TELEGRAM_ID ?? '467595754').trim();
  try {
    return BigInt(raw);
  } catch {
    return BigInt(467595754);
  }
})();
const LEARNED_STAGE_MIN = 4;

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api', (req, res, next) => {
  const initData = req.header('x-telegram-init-data') ?? '';
  if (!initData) {
    if (allowDev) {
      const devIdRaw = req.header('x-dev-user-id') ?? devUserId;
      if (devIdRaw) {
        const devId = Number(devIdRaw);
        if (Number.isFinite(devId) && devId > 0) {
          req.telegramUserId = BigInt(devId);
          req.telegramUser = { id: devId } as any;
          return next();
        }
      }
    }
    return res.status(401).json({ error: 'unauthorized' });
  }

  const verified = verifyInitData(initData, botToken, maxAgeSeconds);
  if (!verified.ok) {
    return res.status(401).json({ error: verified.error });
  }

  req.telegramUser = verified.user;
  req.telegramUserId = BigInt(verified.user.id);
  return next();
});

const requireAdmin: RequestHandler = (req, res, next) => {
  if (!req.telegramUserId) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (req.telegramUserId !== adminTelegramId) {
    return res.status(403).json({ error: 'forbidden' });
  }
  return next();
};

app.use('/api/admin', requireAdmin);

const sendTelegramMessage = async (chatId: number, text: string) => {
  if (!botToken) {
    throw new Error('BOT_TOKEN is not set');
  }
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`telegram_error:${res.status}:${body}`);
  }
};

const sendTelegramPhoto = async (chatId: number, photoUrl: string, caption?: string) => {
  if (!botToken) {
    throw new Error('BOT_TOKEN is not set');
  }
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      photo: photoUrl,
      caption: caption && caption.length > 0 ? caption : undefined,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`telegram_error:${res.status}:${body}`);
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

app.get('/api/me', async (req, res) => {
  const userId = req.telegramUserId!;
  const user = await ensureUser(Number(userId));
  const referralCount = await countReferrals(user.id);
  res.json({
    id: user.id.toString(),
    language: user.language,
    timezone: user.timezone,
    notificationsEnabled: user.notificationsEnabled,
    notificationIntervalMinutes: user.notificationIntervalMinutes,
    maxNotificationsPerDay: user.maxNotificationsPerDay,
    quietHoursStartMinutes: user.quietHoursStartMinutes,
    quietHoursEndMinutes: user.quietHoursEndMinutes,
    streakCount: user.streakCount,
    doneTodayCount: user.doneTodayCount,
    referralCount,
  });
});

app.patch('/api/me', async (req, res) => {
  const userId = req.telegramUserId!;
  await ensureUser(Number(userId));
  const { language } = req.body ?? {};

  if (typeof language === 'string') {
    const normalized = language === 'uz' ? 'uz' : 'ru';
    await setLanguage(Number(userId), normalized);
  }

  const user = await ensureUser(Number(userId));
  const referralCount = await countReferrals(user.id);
  res.json({
    id: user.id.toString(),
    language: user.language,
    timezone: user.timezone,
    notificationsEnabled: user.notificationsEnabled,
    notificationIntervalMinutes: user.notificationIntervalMinutes,
    maxNotificationsPerDay: user.maxNotificationsPerDay,
    quietHoursStartMinutes: user.quietHoursStartMinutes,
    quietHoursEndMinutes: user.quietHoursEndMinutes,
    streakCount: user.streakCount,
    doneTodayCount: user.doneTodayCount,
    referralCount,
  });
});

app.get('/api/stats', async (req, res) => {
  const userId = req.telegramUserId!;
  const user = await resetProgressIfNeeded(await ensureUser(Number(userId)));
  const words = await countUserWords(user.id);
  const now = userNow(user.timezone ?? 'UTC');
  const todayStart = startOfUserDay(user.timezone ?? 'UTC', now);
  const tomorrow = todayStart.add(1, 'day');
  const dueToday = await countDueToday(
    user.id,
    todayStart.utc().toDate(),
    tomorrow.utc().toDate()
  );
  const learnedCount = await prisma.review.count({
    where: {
      userId: user.id,
      stage: { gte: LEARNED_STAGE_MIN },
    },
  });
  res.json({
    streakCount: user.streakCount,
    words,
    doneTodayCount: user.doneTodayCount,
    dailyLimit: user.maxNotificationsPerDay,
    dueToday,
    learnedCount,
  });
});

app.get('/api/settings', async (req, res) => {
  const userId = req.telegramUserId!;
  const user = await ensureUser(Number(userId));
  res.json({
    notificationsEnabled: user.notificationsEnabled,
    notificationIntervalMinutes: user.notificationIntervalMinutes,
    maxNotificationsPerDay: user.maxNotificationsPerDay,
    quietHoursStartMinutes: user.quietHoursStartMinutes,
    quietHoursEndMinutes: user.quietHoursEndMinutes,
  });
});

app.patch('/api/settings', async (req, res) => {
  const userId = req.telegramUserId!;
  await ensureUser(Number(userId));
  const {
    notificationsEnabled,
    notificationIntervalMinutes,
    maxNotificationsPerDay,
    quietHoursStartMinutes,
    quietHoursEndMinutes,
  } = req.body ?? {};

  if (typeof notificationsEnabled === 'boolean') {
    await setNotifications(Number(userId), notificationsEnabled);
  }

  if (typeof notificationIntervalMinutes === 'number' && Number.isFinite(notificationIntervalMinutes)) {
    await setNotificationInterval(Number(userId), notificationIntervalMinutes);
  }

  if (typeof maxNotificationsPerDay === 'number' && Number.isFinite(maxNotificationsPerDay)) {
    await setNotificationLimit(Number(userId), maxNotificationsPerDay);
  }

  if (
    typeof quietHoursStartMinutes === 'number' &&
    typeof quietHoursEndMinutes === 'number' &&
    Number.isFinite(quietHoursStartMinutes) &&
    Number.isFinite(quietHoursEndMinutes)
  ) {
    await setQuietHours(Number(userId), quietHoursStartMinutes, quietHoursEndMinutes);
  }

  const user = await ensureUser(Number(userId));
  res.json({
    notificationsEnabled: user.notificationsEnabled,
    notificationIntervalMinutes: user.notificationIntervalMinutes,
    maxNotificationsPerDay: user.maxNotificationsPerDay,
    quietHoursStartMinutes: user.quietHoursStartMinutes,
    quietHoursEndMinutes: user.quietHoursEndMinutes,
    constraints: {
      minInterval: MIN_NOTIFICATION_INTERVAL,
      maxInterval: MAX_NOTIFICATION_INTERVAL,
      minLimit: MIN_NOTIFICATIONS_PER_DAY,
      maxLimit: MAX_NOTIFICATIONS_PER_DAY,
    },
  });
});

app.get('/api/words', async (req, res) => {
  const userId = req.telegramUserId!;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;
  const take = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw!, 1), 200) : 50;

  const where: Prisma.WordWhereInput = q
    ? {
        userId,
        OR: [
          { wordEn: { contains: q, mode: 'insensitive' } },
          { translationRu: { contains: q, mode: 'insensitive' } },
        ],
      }
    : { userId };

  const items = await prisma.word.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take,
    include: {
      review: {
        select: {
          stage: true,
          nextReviewAt: true,
        },
      },
    },
  });

  res.json({
    items: items.map((item) => ({
      id: item.id,
      wordEn: item.wordEn,
      translationRu: item.translationRu,
      createdAt: item.createdAt,
      stage: item.review?.stage ?? null,
      nextReviewAt: item.review?.nextReviewAt ?? null,
    })),
  });
});

app.delete('/api/words/:id', async (req, res) => {
  const userId = req.telegramUserId!;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'invalid_id' });
  }

  try {
    // Be explicit: delete review first to avoid FK issues on environments
    // where ON DELETE CASCADE might not be in sync yet.
    const [, wordsDeleted] = await prisma.$transaction([
      prisma.review.deleteMany({
        where: {
          userId,
          wordId: id,
        },
      }),
      prisma.word.deleteMany({
        where: {
          id,
          userId,
        },
      }),
    ]);

    if (wordsDeleted.count === 0) {
      return res.status(404).json({ error: 'not_found' });
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error('DELETE /api/words/:id failed', { userId: userId.toString(), id, error });
    return res.status(500).json({ error: 'delete_failed' });
  }
});

app.get('/api/admin/overview', async (_req, res) => {
  const now = nowUtc();
  const startUtcDay = now.startOf('day').toDate();
  const weekAgo = now.subtract(7, 'day').toDate();

  const [
    totalUsers,
    totalWords,
    notificationsAgg,
    activeToday,
    newLast7Days,
    recentUsers,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.word.count(),
    prisma.user.aggregate({
      _sum: { notificationsSentToday: true },
    }),
    prisma.user.count({
      where: {
        lastDoneDate: { gte: startUtcDay },
        doneTodayCount: { gt: 0 },
      },
    }),
    prisma.user.count({
      where: {
        createdAt: { gte: weekAgo },
      },
    }),
    prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: {
        id: true,
        createdAt: true,
        _count: { select: { words: true } },
      },
    }),
  ]);

  const recentIds = recentUsers.map((user) => user.id);
  const [learnedCounts, skippedCounts] = await Promise.all([
    recentIds.length
      ? prisma.review.groupBy({
          by: ['userId'],
          where: { userId: { in: recentIds }, stage: { gte: LEARNED_STAGE_MIN } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    recentIds.length
      ? prisma.review.groupBy({
          by: ['userId'],
          where: { userId: { in: recentIds }, lastResult: 'SKIPPED' },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);

  const learnedMap = new Map<string, number>(
    learnedCounts.map((row) => [row.userId.toString(), row._count._all])
  );
  const skippedMap = new Map<string, number>(
    skippedCounts.map((row) => [row.userId.toString(), row._count._all])
  );

  res.json({
    totals: {
      users: totalUsers,
      words: totalWords,
      notificationsSentToday: notificationsAgg._sum.notificationsSentToday ?? 0,
    },
    activeToday,
    newLast7Days,
    recentUsers: recentUsers.map((user) => ({
      id: user.id.toString(),
      createdAt: user.createdAt,
      wordsCount: user._count.words,
      learnedCount: learnedMap.get(user.id.toString()) ?? 0,
      postponedCount: skippedMap.get(user.id.toString()) ?? 0,
    })),
  });
});

app.get('/api/admin/users/:id', async (req, res) => {
  const rawId = Number(req.params.id);
  if (!Number.isFinite(rawId) || rawId <= 0 || !Number.isInteger(rawId)) {
    return res.status(400).json({ error: 'invalid_id' });
  }
  const userId = BigInt(rawId);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, createdAt: true },
  });

  if (!user) {
    return res.status(404).json({ error: 'not_found' });
  }

  const [wordsCount, learnedCount, postponedCount] = await Promise.all([
    prisma.word.count({ where: { userId } }),
    prisma.review.count({ where: { userId, stage: { gte: LEARNED_STAGE_MIN } } }),
    prisma.review.count({ where: { userId, lastResult: 'SKIPPED' } }),
  ]);

  return res.json({
    id: user.id.toString(),
    createdAt: user.createdAt,
    wordsCount,
    learnedCount,
    postponedCount,
  });
});

app.post('/api/admin/broadcast', async (req, res) => {
  const { message, photoUrl } = req.body ?? {};
  const trimmedMessage = typeof message === 'string' ? message.trim() : '';
  const trimmedPhoto = typeof photoUrl === 'string' ? photoUrl.trim() : '';
  if (!trimmedMessage && !trimmedPhoto) {
    return res.status(400).json({ error: 'empty_message' });
  }
  if (trimmedMessage.length > 4000) {
    return res.status(400).json({ error: 'message_too_long' });
  }
  if (trimmedPhoto && trimmedMessage.length > 1024) {
    return res.status(400).json({ error: 'caption_too_long' });
  }

  const users = await prisma.user.findMany({ select: { id: true } });
  let sent = 0;
  let failed = 0;

  for (const user of users) {
    try {
      if (trimmedPhoto) {
        await sendTelegramPhoto(Number(user.id), trimmedPhoto, trimmedMessage);
      } else {
        await sendTelegramMessage(Number(user.id), trimmedMessage);
      }
      sent += 1;
    } catch (err) {
      failed += 1;
    }
    await sleep(50);
  }

  return res.json({ ok: true, total: users.length, sent, failed });
});

export const startApiServer = () => {
  const port = parseInt(process.env.API_PORT ?? '3001', 10);
  return app.listen(port, () => {
    console.log(`API server listening on :${port}`);
  });
};

if (require.main === module) {
  startApiServer();
}

