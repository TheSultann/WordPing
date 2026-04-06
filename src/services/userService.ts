import type { DirectionMode, User } from '../generated/prisma/client';
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

export type TelegramProfile = {
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

const normalizeProfileValue = (value?: string | null, maxLen = 128): string | null => {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
};

export const buildDisplayName = (
  firstName?: string | null,
  lastName?: string | null,
  fallback?: string | null
): string | null => {
  const combined = `${firstName ?? ''} ${lastName ?? ''}`.trim();
  if (combined) return combined.slice(0, 191);
  const trimmedFallback = (fallback ?? '').trim();
  return trimmedFallback ? trimmedFallback.slice(0, 191) : null;
};

const buildProfileData = (profile?: TelegramProfile) => {
  if (!profile) return {};
  const firstName = normalizeProfileValue(profile.firstName, 128);
  const lastName = normalizeProfileValue(profile.lastName, 128);
  const usernameRaw = normalizeProfileValue(profile.username, 64);
  const username = usernameRaw?.replace(/^@+/, '') ?? null;

  return {
    tgFirstName: firstName,
    tgLastName: lastName,
    tgUsername: username,
    tgDisplayName: buildDisplayName(firstName, lastName),
    lastSeenAt: new Date(),
  };
};

const normalizeMinutes = (value: number) => ((value % 1440) + 1440) % 1440;

const calculateWindowSpanMinutes = (startMinutes: number, endMinutes: number) => {
  if (startMinutes === endMinutes) return 1440;
  return startMinutes < endMinutes
    ? endMinutes - startMinutes
    : 1440 - (startMinutes - endMinutes);
};

export class QuietHoursSpanError extends Error {
  readonly code = 'quiet_hours_span_too_short';
  readonly minSpanMinutes: number;

  constructor(minSpanMinutes = MIN_QUIET_SPAN_MINUTES) {
    super(`Quiet-hours span must be at least ${minSpanMinutes} minutes`);
    this.name = 'QuietHoursSpanError';
    this.minSpanMinutes = minSpanMinutes;
  }
}

export const normalizeQuietHoursWindow = (startMinutes: number, endMinutes: number) => {
  const normalizedStartMinutes = normalizeMinutes(startMinutes);
  const normalizedEndMinutes = normalizeMinutes(endMinutes);
  const span = calculateWindowSpanMinutes(normalizedStartMinutes, normalizedEndMinutes);
  if (span < MIN_QUIET_SPAN_MINUTES) {
    throw new QuietHoursSpanError();
  }
  return {
    quietHoursStartMinutes: normalizedStartMinutes,
    quietHoursEndMinutes: normalizedEndMinutes,
  };
};

export const clampNotificationLimitValue = (maxPerDay: number) =>
  Math.min(Math.max(maxPerDay, MIN_NOTIFICATIONS_PER_DAY), MAX_NOTIFICATIONS_PER_DAY);

export const clampNotificationIntervalValue = (minutes: number) =>
  Math.min(Math.max(minutes, MIN_NOTIFICATION_INTERVAL), MAX_NOTIFICATION_INTERVAL);

export const ensureUser = async (telegramId: number, profile?: TelegramProfile): Promise<User> => {
  const id = toId(telegramId);
  const profileData = buildProfileData(profile) as Record<string, unknown>;
  const user = await prisma.user.upsert({
    where: { id },
    update: profileData as any,
    create: { id, timezone: DEFAULT_TIMEZONE, ...profileData } as any,
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

export const setDoNotDisturbHours = async (telegramId: number, startMinutes: number, endMinutes: number) => {
  const window = normalizeQuietHoursWindow(startMinutes, endMinutes);
  return prisma.user.update({
    where: { id: toId(telegramId) },
    data: window,
  });
};

export const setQuietHours = setDoNotDisturbHours;

export const setNotificationLimit = async (telegramId: number, maxPerDay: number) => {
  const clamped = clampNotificationLimitValue(maxPerDay);
  return prisma.user.update({
    where: { id: toId(telegramId) },
    data: { maxNotificationsPerDay: clamped },
  });
};

export const setNotificationInterval = async (telegramId: number, minutes: number) => {
  const clamped = clampNotificationIntervalValue(minutes);
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

export const markReviewFlowHintShown = async (telegramId: number) => {
  const updated = await prisma.$queryRaw<Array<{ reviewFlowHintShownCount: number }>>`
    UPDATE "User"
    SET "reviewFlowHintShownAt" = COALESCE("reviewFlowHintShownAt", NOW()),
        "reviewFlowHintShownCount" = "reviewFlowHintShownCount" + 1
    WHERE "id" = ${toId(telegramId)}
      AND "reviewFlowHintShownCount" < 2
    RETURNING "reviewFlowHintShownCount"
  `;
  return updated.length > 0;
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
  return prisma.user.count({
    where: {
      referredById: toId(telegramId),
      referralQualifiedAt: { not: null },
    },
  });
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
        correctTodayCount: 0,
        lastDoneDate: today.toDate(),
      },
    });
  }
  return user;
};

export const recordCompletion = async (user: User, isCorrect = false): Promise<DailyProgressResult> => {
  const tz = user.timezone;
  const now = userNow(tz);
  const today = startOfDay(tz, now);
  const lastDoneDay = user.lastDoneDate ? startOfDay(tz, user.lastDoneDate) : null;
  const lastStreakDay = user.lastStreakDate ? startOfDay(tz, user.lastStreakDate) : null;

  let doneToday = lastDoneDay && diffInDays(today, lastDoneDay) === 0 ? user.doneTodayCount : 0;
  let correctToday = lastDoneDay && diffInDays(today, lastDoneDay) === 0 ? user.correctTodayCount : 0;
  doneToday += 1;
  if (isCorrect) correctToday += 1;

  let streakCount = user.streakCount;
  if (lastStreakDay) {
    const diff = diffInDays(today, lastStreakDay);
    if (diff > 1) {
      streakCount = 0;
    }
  }

  let goalReached = false;
  const accuracyQualified = doneToday >= STREAK_DAILY_TARGET && (correctToday / doneToday) > 0.5;
  if (accuracyQualified) {
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
      correctTodayCount: correctToday,
      lastDoneDate: today.toDate(),
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
  // Count unique words that have at least one due review up to end of today.
  // This includes overdue (past-due) words so the UI counter matches what
  // the user will actually receive during the day.
  // This keeps UI "На повтор" on word-level (not doubled by two directions).
  return prisma.word.count({
    where: {
      userId,
      reviews: {
        some: {
          nextReviewAt: {
            lt: tomorrowStartUtc,
          },
        },
      },
    },
  });
};

export const countDueNow = async (userId: bigint, nowUtcDate: Date) => {
  // Count words due right now, excluding words already in learned bucket.
  // This keeps dictionary counters mutually exclusive.
  return prisma.word.count({
    where: {
      userId,
      reviews: {
        some: {
          nextReviewAt: {
            lte: nowUtcDate,
          },
        },
      },
      NOT: {
        reviews: {
          some: {},
          every: { stage: { gte: 4 } },
        },
      },
    },
  });
};
