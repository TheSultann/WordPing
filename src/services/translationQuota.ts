import { prisma } from '../db/client';
import { nowUtc, startOfUserDay } from '../utils/time';

const DEFAULT_DAILY_AUTO_TRANSLATE_LIMIT = 30;

const trimEnv = (value: string | undefined): string => (value ?? '').trim();

const readDailyAutoTranslateLimit = (): number => {
  const raw = Number.parseInt(trimEnv(process.env.DAILY_AUTO_TRANSLATE_LIMIT), 10);
  if (!Number.isFinite(raw) || raw < 1 || raw > 500) return DEFAULT_DAILY_AUTO_TRANSLATE_LIMIT;
  return raw;
};

const readUnlimitedAutoTranslateIds = (): Set<string> => {
  const raw = [
    trimEnv(process.env.UNLIMITED_AUTO_TRANSLATE_IDS),
    trimEnv(process.env.UNLIMITED_WORD_ADD_IDS),
    trimEnv(process.env.ADMIN_USER_IDS),
    trimEnv(process.env.ADMIN_TELEGRAM_ID),
  ]
    .filter(Boolean)
    .join(',');

  const ids = new Set<string>();
  for (const chunk of raw.split(',')) {
    const id = chunk.trim();
    if (/^\d+$/.test(id)) ids.add(id);
  }
  return ids;
};

const isUnlimitedAutoTranslateUser = (userId: bigint): boolean => {
  return readUnlimitedAutoTranslateIds().has(userId.toString());
};

export type ConsumeAutoTranslateQuotaResult = {
  allowed: boolean;
  unlimited: boolean;
  limit: number;
  used: number;
  remaining: number;
};

const ensureDailyUsage = async (userId: bigint, timezone?: string | null) => {
  const now = nowUtc();
  const dayStart = startOfUserDay(timezone, now).toDate();
  await prisma.userDailyUsage.upsert({
    where: { userId_dayStart: { userId, dayStart } },
    create: { userId, dayStart, autoTranslateCount: 0 },
    update: {},
  });
  return dayStart;
};

const readUsageCount = async (userId: bigint, dayStart: Date): Promise<number> => {
  const usage = await prisma.userDailyUsage.findUnique({
    where: { userId_dayStart: { userId, dayStart } },
    select: { autoTranslateCount: true },
  });
  return usage?.autoTranslateCount ?? 0;
};

const buildQuotaResult = (
  limit: number,
  used: number,
  allowed: boolean,
  unlimited = false
): ConsumeAutoTranslateQuotaResult => ({
  allowed,
  unlimited,
  limit,
  used,
  remaining: Math.max(0, limit - used),
});

export const checkAutoTranslateQuota = async (
  userId: bigint,
  timezone?: string | null
): Promise<ConsumeAutoTranslateQuotaResult> => {
  const limit = readDailyAutoTranslateLimit();

  if (isUnlimitedAutoTranslateUser(userId)) {
    return { allowed: true, unlimited: true, limit, used: 0, remaining: Number.MAX_SAFE_INTEGER };
  }

  const dayStart = await ensureDailyUsage(userId, timezone);
  const used = await readUsageCount(userId, dayStart);
  return buildQuotaResult(limit, used, used < limit);
};

export const commitAutoTranslateQuota = async (
  userId: bigint,
  timezone?: string | null
): Promise<ConsumeAutoTranslateQuotaResult> => {
  const limit = readDailyAutoTranslateLimit();

  if (isUnlimitedAutoTranslateUser(userId)) {
    return { allowed: true, unlimited: true, limit, used: 0, remaining: Number.MAX_SAFE_INTEGER };
  }

  const dayStart = await ensureDailyUsage(userId, timezone);

  const updated = await prisma.userDailyUsage.updateMany({
    where: {
      userId,
      dayStart,
      autoTranslateCount: { lt: limit },
    },
    data: {
      autoTranslateCount: { increment: 1 },
    },
  });

  const used = await readUsageCount(userId, dayStart);
  return buildQuotaResult(limit, used, updated.count > 0);
};

// Backward-compatible alias.
export const consumeAutoTranslateQuota = commitAutoTranslateQuota;
