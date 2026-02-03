import 'dotenv/config';
import express from 'express';
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
import { startOfUserDay, userNow } from '../utils/time';
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
  res.json({
    streakCount: user.streakCount,
    words,
    doneTodayCount: user.doneTodayCount,
    dailyLimit: user.maxNotificationsPerDay,
    dueToday,
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
  });

  res.json({
    items: items.map((item) => ({
      id: item.id,
      wordEn: item.wordEn,
      translationRu: item.translationRu,
      createdAt: item.createdAt,
    })),
  });
});

app.delete('/api/words/:id', async (req, res) => {
  const userId = req.telegramUserId!;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'invalid_id' });
  }

  const result = await prisma.word.deleteMany({
    where: {
      id,
      userId,
    },
  });

  if (result.count === 0) {
    return res.status(404).json({ error: 'not_found' });
  }

  return res.json({ ok: true });
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

