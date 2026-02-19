import { DirectionMode, User } from '../generated/prisma/client';
import { prisma } from '../db/client';
import { ensureSession } from './sessionService';
import { DEFAULT_TIMEZONE, diffInDays, startOfUserDay, userNow } from '../utils/time';
import dayjs from '../utils/time';

export const DEFAULT_QUIET_START = 480; // 08:00
export const DEFAULT_QUIET_END = 1380; // 23:00
export const DEFAULT_MAX_NOTIFICATIONS = 20;
export const DEFAULT_NOTIFICATION_INTERVAL = 30; // minutes
export const MIN_NOTIFICATION_INTERVAL = 5;
export const MAX_NOTIFICATION_INTERVAL = 240;
export const MIN_NOTIFICATIONS_PER_DAY = 5;
export const MAX_NOTIFICATIONS_PER_DAY = 40;
export const MIN_QUIET_SPAN_MINUTES = 480; // 8 hours
export const STREAK_DAILY_TARGET = 3;

const toId = (telegramId: number | string | bigint): bigint => BigInt(telegramId);

const startOfDay = (tz: string | null | undefined, date?: Date | dayjs.Dayjs) =>
  startOfUserDay(tz, date ? dayjs(date) : undefined);

export const ensureUser = async (telegramId: number): Promise<User> => {
  const id = toId(telegramId);
  const user = await prisma.user.upsert({
    where: { id },
    update: {},
    create: { id, timezone: DEFAULT_TIMEZONE },
  });
  await ensureSession(id);
  return user;
};

export const getUser = async (telegramId: number): Promise<User | null> => {
  return prisma.user.findUnique({ where: { id: toId(telegramId) } });
};

// Direction setting is unused in UI, kept for compatibility.
export const setDirectionMode = async (telegramId: number, mode: DirectionMode) => {
  return prisma.user.update({ where: { id: toId(telegramId) }, data: { directionMode: mode } });
};

export const setNotifications = async (telegramId: number, enabled: boolean) => {
  return prisma.user.update({ where: { id: toId(telegramId) }, data: { notificationsEnabled: enabled } });
};

export const setQuietHours = async (telegramId: number, startMinutes: number, endMinutes: number) => {
  // enforce at least MIN_QUIET_SPAN_MINUTES span to avoid too narrow windows
  const normStart = ((startMinutes % 1440) + 1440) % 1440;
  let normEnd = ((endMinutes % 1440) + 1440) % 1440;
  const span =
    normStart === normEnd
      ? 1440
      : normStart < normEnd
        ? normEnd - normStart
        : 1440 - (normStart - normEnd);
  if (span < MIN_QUIET_SPAN_MINUTES) {
    normEnd = (normStart + MIN_QUIET_SPAN_MINUTES) % 1440;
  }
  return prisma.user.update({
    where: { id: toId(telegramId) },
    data: { quietHoursStartMinutes: normStart, quietHoursEndMinutes: normEnd },
  });
};

export const setNotificationLimit = async (telegramId: number, maxPerDay: number) => {
  const clamped = Math.min(Math.max(maxPerDay, MIN_NOTIFICATIONS_PER_DAY), MAX_NOTIFICATIONS_PER_DAY);
  return prisma.user.update({
    where: { id: toId(telegramId) },
    data: { maxNotificationsPerDay: clamped },
  });
};

export const setNotificationInterval = async (telegramId: number, minutes: number) => {
  const clamped = Math.min(Math.max(minutes, MIN_NOTIFICATION_INTERVAL), MAX_NOTIFICATION_INTERVAL);
  return prisma.user.update({
    where: { id: toId(telegramId) },
    data: { notificationIntervalMinutes: clamped },
  });
};

export const setTimezone = async (telegramId: number, timezone?: string | null) => {
  return prisma.user.update({ where: { id: toId(telegramId) }, data: { timezone: timezone ?? null } });
};

export const setLanguage = async (telegramId: number, language: string) => {
  return prisma.user.update({ where: { id: toId(telegramId) }, data: { language } });
};

export const setReferredByIfEmpty = async (telegramId: number, referrerId: number) => {
  if (!Number.isFinite(referrerId) || referrerId <= 0) return;
  if (telegramId === referrerId) return;
  const referrer = await prisma.user.findUnique({ where: { id: toId(referrerId) }, select: { id: true } });
  if (!referrer) return;
  await prisma.user.updateMany({
    where: {
      id: toId(telegramId),
      referredById: null,
    },
    data: {
      referredById: toId(referrerId),
    },
  });
};

export const countReferrals = async (telegramId: number | bigint) => {
  return prisma.user.count({ where: { referredById: toId(telegramId) } });
};

export type DailyProgressResult = {
  streakCount: number;
  todayCompleted: number;
  goalReached: boolean;
};

export const resetNotificationCountersIfNeeded = async (user: User): Promise<User> => {
  const tz = user.timezone;
  const now = userNow(tz);
  const today = startOfDay(tz, now);
  const lastDate = user.notificationsDate ? startOfDay(tz, user.notificationsDate) : null;
  if (!lastDate || diffInDays(today, lastDate) !== 0) {
    return prisma.user.update({
      where: { id: user.id },
      data: { notificationsSentToday: 0, notificationsDate: today.toDate() },
    });
  }
  return user;
};

export const resetProgressIfNeeded = async (user: User): Promise<User> => {
  const tz = user.timezone;
  const now = userNow(tz);
  const today = startOfDay(tz, now);
  const lastDoneDay = user.lastDoneDate ? startOfDay(tz, user.lastDoneDate) : null;
  if (!lastDoneDay || diffInDays(today, lastDoneDay) !== 0) {
    return prisma.user.update({
      where: { id: user.id },
      data: {
        doneTodayCount: 0,
        lastDoneDate: today.toDate(),
        todayCompleted: 0, // legacy sync
        todayDate: today.toDate(),
      },
    });
  }
  return user;
};

export const recordCompletion = async (user: User): Promise<DailyProgressResult> => {
  const tz = user.timezone;
  const now = userNow(tz);
  const today = startOfDay(tz, now);
  const lastDoneDay = user.lastDoneDate ? startOfDay(tz, user.lastDoneDate) : null;
  const lastStreakDay = user.lastStreakDate ? startOfDay(tz, user.lastStreakDate) : null;

  let doneToday = lastDoneDay && diffInDays(today, lastDoneDay) === 0 ? user.doneTodayCount : 0;
  doneToday += 1;

  let streakCount = user.streakCount;
  if (lastStreakDay) {
    const diff = diffInDays(today, lastStreakDay);
    if (diff > 1) {
      streakCount = 0;
    }
  }

  let goalReached = false;
  if (doneToday >= STREAK_DAILY_TARGET) {
    if (!lastStreakDay) {
      streakCount = 1;
      goalReached = true;
    } else {
      const diff = diffInDays(today, lastStreakDay);
      if (diff === 0) {
        goalReached = true;
      } else if (diff === 1) {
        streakCount += 1;
        goalReached = true;
      } else if (diff > 1) {
        streakCount = 1;
        goalReached = true;
      }
    }
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      doneTodayCount: doneToday,
      lastDoneDate: today.toDate(),
      todayCompleted: doneToday, // keep legacy in sync
      todayDate: today.toDate(),
      streakCount,
      lastStreakDate: goalReached ? today.toDate() : user.lastStreakDate,
    },
  });

  return {
    streakCount: updated.streakCount,
    todayCompleted: updated.doneTodayCount,
    goalReached,
  };
};

export const countUserWords = async (userId: bigint) => {
  return prisma.word.count({ where: { userId } });
};

export const countDueToday = async (userId: bigint, todayStartUtc: Date, tomorrowStartUtc: Date) => {
  return prisma.review.count({
    where: {
      userId,
      nextReviewAt: {
        gte: todayStartUtc,
        lt: tomorrowStartUtc,
      },
    },
  });
};

