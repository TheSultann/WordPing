import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import express, { type RequestHandler } from 'express';
import cors from 'cors';
import { prisma } from '../db/client';
import type { Prisma } from '../generated/prisma/client';
import {
  countDueNow,
  countDueToday,
  countUserWords,
  ensureUser,
  type TelegramProfile,
  buildDisplayName,
  resetProgressIfNeeded,
  resetNotificationCountersIfNeeded,
  setLanguage,
  setNotificationInterval,
  setNotificationLimit,
  setNotifications,
  QuietHoursSpanError,
  setDoNotDisturbHours,
  countReferrals,
  MIN_NOTIFICATION_INTERVAL,
  MAX_NOTIFICATION_INTERVAL,
  MIN_NOTIFICATIONS_PER_DAY,
  MAX_NOTIFICATIONS_PER_DAY,
} from '../services/userService';
import { resetState } from '../services/sessionService';
import { trimEnv, validateRuntimeEnv } from '../utils/env';
import { createLogger } from '../utils/logger';
import { createRuntimeHealthReporter, readRuntimeHealth } from '../utils/runtimeHealth';
import { DEFAULT_TIMEZONE, nowUtc, startOfUserDay, userNow } from '../utils/time';
import { type TelegramUser, verifyInitData } from './auth';

validateRuntimeEnv('api');

export const app = express();
const apiLogger = createLogger('api');
const apiHealth = createRuntimeHealthReporter('api');

const parseOrigins = (value?: string) =>
  (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

const defaultOrigins = process.env.NODE_ENV === 'production'
  ? []
  : ['http://localhost:5173', 'http://127.0.0.1:5173'];

const allowedOrigins = Array.from(new Set([...parseOrigins(process.env.WEB_ORIGIN), ...defaultOrigins]));

const parseTimezone = (value?: string | null): string | null => {
  const timezone = (value ?? '').trim();
  if (!timezone) return null;
  if (timezone.length > 64) return null;
  const normalized = timezone.toLowerCase();
  if (
    normalized === 'utc' ||
    normalized === 'etc/utc' ||
    normalized === 'gmt' ||
    normalized === 'etc/gmt' ||
    normalized === 'etc/gmt+0' ||
    normalized === 'etc/gmt-0'
  ) {
    return DEFAULT_TIMEZONE;
  }
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return null;
  }
};

const parsePositiveBigInt = (raw: string): bigint | null => {
  const value = raw.trim();
  if (!/^\d+$/.test(value)) return null;
  try {
    const parsed = BigInt(value);
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
};

const persistTimezoneIfProvided = async (userId: bigint, timezoneHeader?: string | null) => {
  const timezone = parseTimezone(timezoneHeader);
  if (!timezone) return;
  await prisma.user.upsert({
    where: { id: userId },
    update: { timezone },
    create: { id: userId, timezone },
  });
};

const toTelegramProfile = (user?: TelegramUser | null): TelegramProfile | undefined => {
  if (!user) return undefined;
  return {
    username: user.username ?? null,
    firstName: user.first_name ?? null,
    lastName: user.last_name ?? null,
  };
};



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

app.use('/api', (req, res, next) => {
  const startedAt = performance.now();
  const requestId = trimEnv(req.header('x-request-id')) || randomUUID();
  res.setHeader('x-request-id', requestId);

  res.on('finish', () => {
    const isHealthRequest = req.path === '/health';
    if (isHealthRequest && res.statusCode < 400) return;

    const context = {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Math.round(performance.now() - startedAt),
      ip: req.ip,
      userId: req.telegramUserId?.toString(),
    };

    if (res.statusCode >= 500) {
      apiLogger.error('request failed', context);
      return;
    }
    if (res.statusCode >= 400) {
      apiLogger.warn('request completed with client error', context);
      return;
    }
    apiLogger.info('request completed', context);
  });

  next();
});

const botToken = process.env.BOT_TOKEN ?? '';
const maxAgeSeconds = parseInt(process.env.INIT_DATA_MAX_AGE_SECONDS ?? '86400', 10);
const allowDev = process.env.ALLOW_DEV_AUTH === 'true' && process.env.NODE_ENV !== 'production';
const adminTelegramId = (() => {
  const raw = (process.env.ADMIN_TELEGRAM_ID ?? '467595754').trim();
  try {
    return BigInt(raw);
  } catch {
    return BigInt(467595754);
  }
})();
const LEARNED_STAGE_MIN = 4;

app.get('/api/health', async (_req, res) => {
  let databaseOk = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    databaseOk = false;
    apiHealth.markError(error instanceof Error ? error.message : 'database check failed');
    apiLogger.error('database health check failed', { error });
  }

  const services = await readRuntimeHealth();
  const apiSnapshot = apiHealth.snapshot();
  services.api = {
    ...apiSnapshot,
    status: apiSnapshot.state === 'error' ? 'error' : 'ok',
    stale: false,
    updatedAt: new Date().toISOString(),
  };

  const runtimeOk = Object.values(services).every((service) => service.status === 'ok');
  const ok = databaseOk;

  return res.status(ok ? 200 : 503).json({
    ok,
    runtimeOk,
    database: { ok: databaseOk },
    services,
  });
});

app.use('/api', async (req, res, next) => {
  const initData = req.header('x-telegram-init-data') ?? '';
  if (!initData) {
    if (allowDev) {
      const devIdRaw = req.header('x-dev-user-id');
      if (devIdRaw) {
        const devId = Number(devIdRaw);
        if (Number.isFinite(devId) && devId > 0) {
          req.telegramUserId = BigInt(devId);
          req.telegramUser = { id: devId } as any;
          try {
            await ensureUser(devId);
            await persistTimezoneIfProvided(req.telegramUserId, req.header('x-timezone'));
          } catch (error) {
            apiLogger.warn('failed to persist timezone for dev auth request', {
              userId: req.telegramUserId.toString(),
              timezone: req.header('x-timezone'),
              error,
            });
          }
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
  try {
    await ensureUser(verified.user.id, toTelegramProfile(verified.user));
    await persistTimezoneIfProvided(req.telegramUserId, req.header('x-timezone'));
  } catch (error) {
    apiLogger.warn('failed to persist timezone for telegram auth request', {
      userId: req.telegramUserId.toString(),
      timezone: req.header('x-timezone'),
      error,
    });
  }
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

type TelegramApiErrorPayload = {
  ok?: boolean;
  error_code?: number;
  description?: string;
  parameters?: {
    retry_after?: number;
  };
};

const buildTelegramRequestError = (status: number, body: string) => {
  let payload: TelegramApiErrorPayload | null = null;
  try {
    payload = JSON.parse(body) as TelegramApiErrorPayload;
  } catch {
    payload = null;
  }

  const error = new Error(`telegram_error:${status}:${body}`) as Error & {
    response?: {
      error_code?: number;
      statusCode?: number;
      parameters?: {
        retry_after?: number;
      };
    };
  };

  const response: NonNullable<typeof error.response> = {
    error_code: payload?.error_code ?? status,
    statusCode: status,
  };
  if (payload?.parameters?.retry_after !== undefined) {
    response.parameters = { retry_after: payload.parameters.retry_after };
  }
  error.response = response;

  return error;
};

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
    throw buildTelegramRequestError(res.status, body);
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
    throw buildTelegramRequestError(res.status, body);
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
    isAdmin: userId === adminTelegramId,
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
  const baseUser = await ensureUser(Number(userId));
  const progressUser = await resetProgressIfNeeded(baseUser);
  const user = await resetNotificationCountersIfNeeded(progressUser);
  const now = userNow(user.timezone);
  const nowUtcDate = now.utc().toDate();
  const todayStart = startOfUserDay(user.timezone, now);
  const tomorrow = todayStart.add(1, 'day');

  const [wordsTotal, dueTodayCount, dueNowTotal, learnedTotal] = await Promise.all([
    countUserWords(user.id),
    countDueToday(
      user.id,
      todayStart.utc().toDate(),
      tomorrow.utc().toDate()
    ),
    countDueNow(user.id, nowUtcDate),
    prisma.word.count({
      where: {
        userId: user.id,
        reviews: {
          some: {},
          every: { stage: { gte: LEARNED_STAGE_MIN } },
        },
      },
    }),
  ]);

  const accuracyTodayPercent = user.doneTodayCount > 0
    ? Math.round((user.correctTodayCount / user.doneTodayCount) * 100)
    : 0;

  res.json({
    streakCount: user.streakCount,
    wordsTotal,
    learnedTotal,
    dueTodayCount,
    dueNowTotal,
    doneTodayCount: user.doneTodayCount,
    accuracyTodayPercent,
    notificationsSentToday: user.notificationsSentToday,
    dailyLimit: user.maxNotificationsPerDay,
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
    try {
      await setDoNotDisturbHours(Number(userId), quietHoursStartMinutes, quietHoursEndMinutes);
    } catch (error) {
      if (error instanceof QuietHoursSpanError) {
        return res.status(400).json({
          error: error.code,
          minSpanMinutes: error.minSpanMinutes,
        });
      }
      throw error;
    }
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
  const offsetRaw = typeof req.query.offset === 'string' ? parseInt(req.query.offset, 10) : NaN;
  const skip = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

  const where: Prisma.WordWhereInput = q
    ? {
      userId,
      OR: [
        { wordEn: { contains: q, mode: 'insensitive' } },
        { translationRu: { contains: q, mode: 'insensitive' } },
      ],
    }
    : { userId };

  const rows = await prisma.word.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip,
    take: take + 1,
    include: {
      reviews: {
        select: {
          stage: true,
          nextReviewAt: true,
        },
      },
    },
  });

  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;

  res.json({
    items: items.map((item) => {
      const stage = item.reviews.length ? Math.min(...item.reviews.map((review) => review.stage)) : null;
      const nextReviewAt =
        item.reviews
          .map((review) => review.nextReviewAt)
          .filter((value): value is Date => Boolean(value))
          .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

      return {
        id: item.id,
        wordEn: item.wordEn,
        translationRu: item.translationRu,
        createdAt: item.createdAt,
        stage,
        nextReviewAt,
      };
    }),
    hasMore,
  });
});

app.delete('/api/words/:id', async (req, res) => {
  const userId = req.telegramUserId!;
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || !Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'invalid_id' });
  }

  try {
    const word = await prisma.word.findFirst({
      where: {
        id,
        userId,
      },
      select: {
        id: true,
        reviews: {
          select: { id: true },
        },
      },
    });

    if (!word) {
      return res.status(404).json({ error: 'not_found' });
    }

    const reviewIds = word.reviews.map((review) => review.id);
    const sessionNeedsReset = await prisma.userSession.findFirst({
      where: {
        userId,
        OR: [
          { wordId: id },
          ...(reviewIds.length > 0 ? [{ reviewId: { in: reviewIds } }] : []),
        ],
      },
      select: { userId: true },
    });

    // Be explicit: delete review first to avoid FK issues on environments
    // where ON DELETE CASCADE might not be in sync yet.
    await prisma.$transaction([
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

    if (sessionNeedsReset) {
      await resetState(userId);
    }

    return res.json({ ok: true });
  } catch (error) {
    apiLogger.error('delete word failed', { userId: userId.toString(), wordId: id, error });
    return res.status(500).json({ error: 'delete_failed' });
  }
});

app.get('/api/admin/overview', async (_req, res) => {
  const now = nowUtc();
  // lastDoneDate is stored as "start of user day" converted to UTC.
  // For "active today" across timezones, use a rolling 24h window
  // instead of the current UTC day boundary.
  const activeWindowStart = now.subtract(24, 'hour').toDate();
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
      where: { notificationsDate: { gte: activeWindowStart } },
      _sum: { notificationsSentToday: true },
    }),
    prisma.user.count({
      where: {
        lastDoneDate: { gte: activeWindowStart },
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
        tgUsername: true,
        tgFirstName: true,
        tgLastName: true,
        tgDisplayName: true,
        _count: { select: { words: true } },
      },
    } as any),
  ]);

  const recentIds = recentUsers.map((user) => user.id);
  const [learnedCounts, skippedCounts] = await Promise.all([
    recentIds.length
      ? prisma.word.groupBy({
        by: ['userId'],
        where: {
          userId: { in: recentIds },
          reviews: {
            some: {},
            every: { stage: { gte: LEARNED_STAGE_MIN } },
          },
        },
        _count: { _all: true },
      })
      : Promise.resolve([]),
    recentIds.length
      ? prisma.word.groupBy({
        by: ['userId'],
        where: {
          userId: { in: recentIds },
          reviews: { some: { lastResult: 'SKIPPED' } },
        },
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
      tgUsername: user.tgUsername,
      tgFirstName: user.tgFirstName,
      tgLastName: user.tgLastName,
      displayName: buildDisplayName(user.tgFirstName, user.tgLastName, user.tgDisplayName),
      wordsCount: (user as any)._count?.words ?? 0,
      learnedCount: learnedMap.get(user.id.toString()) ?? 0,
      postponedCount: skippedMap.get(user.id.toString()) ?? 0,
    })),
  });
});

app.get('/api/admin/users', async (req, res) => {
  const rawQuery = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const query = rawQuery.toLowerCase();
  const normalizedUsername = query.replace(/^@+/, '');
  const limitRaw = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : NaN;
  const take = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
  const offsetRaw = typeof req.query.offset === 'string' ? Number.parseInt(req.query.offset, 10) : NaN;
  const skip = Number.isFinite(offsetRaw) ? Math.min(Math.max(offsetRaw, 0), 10000) : 0;
  const idCandidate = /^\d+$/.test(query) ? BigInt(query) : null;

  const where: any = query
    ? {
      OR: [
        ...(idCandidate ? [{ id: idCandidate }] : []),
        { tgUsername: { contains: normalizedUsername, mode: 'insensitive' } },
        { tgDisplayName: { contains: rawQuery, mode: 'insensitive' } },
        { tgFirstName: { contains: rawQuery, mode: 'insensitive' } },
        { tgLastName: { contains: rawQuery, mode: 'insensitive' } },
      ],
    }
    : {};

  const users = await prisma.user.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip,
    take: take + 1,
    select: {
      id: true,
      createdAt: true,
      tgUsername: true,
      tgFirstName: true,
      tgLastName: true,
      tgDisplayName: true,
      _count: { select: { words: true } },
    },
  } as any);

  const hasMore = users.length > take;
  const visibleUsers = hasMore ? users.slice(0, take) : users;

  const userIds = visibleUsers.map((user) => user.id);
  const [learnedCounts, skippedCounts] = await Promise.all([
    userIds.length
      ? prisma.word.groupBy({
        by: ['userId'],
        where: {
          userId: { in: userIds },
          reviews: {
            some: {},
            every: { stage: { gte: LEARNED_STAGE_MIN } },
          },
        },
        _count: { _all: true },
      })
      : Promise.resolve([]),
    userIds.length
      ? prisma.word.groupBy({
        by: ['userId'],
        where: {
          userId: { in: userIds },
          reviews: { some: { lastResult: 'SKIPPED' } },
        },
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
    items: visibleUsers.map((user) => ({
      id: user.id.toString(),
      createdAt: user.createdAt,
      tgUsername: user.tgUsername,
      tgFirstName: user.tgFirstName,
      tgLastName: user.tgLastName,
      displayName: buildDisplayName(user.tgFirstName, user.tgLastName, user.tgDisplayName),
      wordsCount: (user as any)._count?.words ?? 0,
      learnedCount: learnedMap.get(user.id.toString()) ?? 0,
      postponedCount: skippedMap.get(user.id.toString()) ?? 0,
    })),
    hasMore,
  });
});

app.get('/api/admin/users/:id', async (req, res) => {
  const userId = parsePositiveBigInt(req.params.id);
  if (!userId) {
    return res.status(400).json({ error: 'invalid_id' });
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, createdAt: true, tgUsername: true, tgFirstName: true, tgLastName: true, tgDisplayName: true },
  } as any);

  if (!user) {
    return res.status(404).json({ error: 'not_found' });
  }

  const [wordsCount, learnedCount, postponedCount] = await Promise.all([
    prisma.word.count({ where: { userId } }),
    prisma.word.count({
      where: {
        userId,
        reviews: {
          some: {},
          every: { stage: { gte: LEARNED_STAGE_MIN } },
        },
      },
    }),
    prisma.word.count({
      where: {
        userId,
        reviews: { some: { lastResult: 'SKIPPED' } },
      },
    }),
  ]);

  return res.json({
    id: user.id.toString(),
    createdAt: user.createdAt,
    tgUsername: user.tgUsername,
    tgFirstName: user.tgFirstName,
    tgLastName: user.tgLastName,
    displayName: buildDisplayName(user.tgFirstName, user.tgLastName, user.tgDisplayName),
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
  const MAX_RETRIES = 3;

  for (const user of users) {
    let success = false;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (trimmedPhoto) {
          await sendTelegramPhoto(Number(user.id), trimmedPhoto, trimmedMessage);
        } else {
          await sendTelegramMessage(Number(user.id), trimmedMessage);
        }
        success = true;
        break;
      } catch (err: any) {
        const retryAfter = err?.response?.parameters?.retry_after;
        const status = err?.response?.error_code ?? err?.response?.statusCode;
        if (status === 429 && retryAfter && attempt < MAX_RETRIES) {
          const waitMs = Math.min(retryAfter, 60) * 1000;
          await sleep(waitMs);
          continue;
        }
        break;
      }
    }
    if (success) {
      sent += 1;
    } else {
      failed += 1;
    }
    await sleep(60);
  }

  return res.json({ ok: true, total: users.length, sent, failed });
});

export const startApiServer = () => {
  apiHealth.start();
  apiHealth.markOk('api server starting');
  const port = parseInt(process.env.API_PORT ?? '3001', 10);
  return app.listen(port, () => {
    apiHealth.markOk('api server listening');
    apiLogger.info('api server listening', { port });
  });
};

if (require.main === module) {
  startApiServer();
}

