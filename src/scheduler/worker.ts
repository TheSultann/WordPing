import 'dotenv/config';
import { t, Lang } from '../i18n';
import cron from 'node-cron';
import { Telegraf } from 'telegraf';
import { prisma } from '../db/client';
import { ensureSession, setState, setSessionActiveIfIdle } from '../services/sessionService';
import { findDueReview, findDueReviewByStage, markSkipped, pickDirection } from '../services/reviewService';
import { CardDirection } from '../generated/prisma/client';
import { isWithinWindow, nowUtc, startOfUserDay, userNow } from '../utils/time';
import dayjs from 'dayjs';
import {
  resetNotificationCountersIfNeeded,
  DEFAULT_MAX_NOTIFICATIONS,
  DEFAULT_NOTIFICATION_INTERVAL,
  DEFAULT_QUIET_START,
  DEFAULT_QUIET_END,
  MIN_NOTIFICATION_INTERVAL,
} from '../services/userService';

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error('BOT_TOKEN is not set');
}

export const telegram = new Telegraf(token).telegram;

type SessionLike = {
  reviewId?: number | null;
  sentAt?: Date | null;
  direction?: CardDirection | null;
  reminderStep?: number | null;
  wordId?: number | null;
};

const hasDailyNotificationCapacity = (user: any) => {
  const limit = user.maxNotificationsPerDay ?? DEFAULT_MAX_NOTIFICATIONS;
  return (user.notificationsSentToday ?? 0) < limit;
};

const hasNotificationIntervalElapsed = (user: any, now: dayjs.Dayjs) => {
  const interval = Math.max(user.notificationIntervalMinutes ?? DEFAULT_NOTIFICATION_INTERVAL, MIN_NOTIFICATION_INTERVAL);
  if (user.lastNotificationAt) {
    const last = dayjs(user.lastNotificationAt);
    if (now.diff(last, 'minute') < interval) return false;
  }
  return true;
};

const registerNotification = async (user: any) => {
  const tz = user.timezone;
  const today = startOfUserDay(tz, userNow(tz)).toDate();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      notificationsSentToday: { increment: 1 },
      notificationsDate: today,
      lastNotificationAt: nowUtc().toDate(),
    },
  });
};

const sendCard = async (userId: number, direction: CardDirection, phrase: string) => {
  const prompt = `Translate: ${phrase}\n(Reply with text)`;
  await telegram.sendMessage(userId, prompt);
};

const hintPrefix = (lang: Lang) => (lang === 'uz' ? 'Ishora 💡' : 'Подсказка💡');

const buildMaskedHint = (value: string, revealIndexes: number[]) => {
  const chars = Array.from(value);
  if (!chars.length) return null;

  const reveal = new Set<number>();
  for (const index of revealIndexes) {
    if (index >= 0 && index < chars.length) reveal.add(index);
  }

  return chars
    .map((char, index) => {
      if (reveal.has(index)) return char;
      if (/\s|['’`-]/.test(char)) return char;
      return '_';
    })
    .join('');
};

const buildHint = (
  direction: CardDirection,
  word: { wordEn: string; translationRu: string },
  hardStreak: number | undefined,
  lang: Lang
) => {
  const streak = Math.max(hardStreak ?? 0, 0);
  if (streak < 1) return null;

  const target = (direction === 'EN_TO_RU' ? word.translationRu : word.wordEn).trim();
  const chars = Array.from(target);
  if (!chars.length) return null;

  const revealIndexes = [0];
  if (streak >= 2 && chars.length > 1) revealIndexes.push(chars.length - 1);
  if (streak >= 3 && chars.length > 2) revealIndexes.push(1);

  const masked = buildMaskedHint(target, revealIndexes);
  if (!masked) return null;

  return `${hintPrefix(lang)}: ${masked}`;
};

export const handleReminders = async (user: any, session: SessionLike, canNotify: boolean) => {
  if (!session.sentAt || !session.reviewId) return;
  const sentAt = dayjs(session.sentAt);
  const now = nowUtc();
  const diff = now.diff(sentAt, 'minute');
  const step = session.reminderStep ?? 0;
  const lang = (user.language as Lang) || 'ru';

  if (diff >= 20) {
    const review = await prisma.review.findUnique({ where: { id: session.reviewId } });
    if (review) {
      await markSkipped(review);
    }
    if (canNotify) {
      await telegram.sendMessage(Number(user.id), t(lang, 'worker.skipped'), { parse_mode: 'HTML' });
    }
    await setState(BigInt(user.id), 'IDLE');
    return;
  }

  if (diff >= 5 && step === 0 && canNotify) {
    await telegram.sendMessage(Number(user.id), t(lang, 'worker.reminder'), { parse_mode: 'HTML' });
    await setState(BigInt(user.id), 'WAITING_ANSWER', {
      ...session,
      reminderStep: 1,
    });
    return;
  }
};

export const processUser = async (user: any) => {
  const normalizedUser = await resetNotificationCountersIfNeeded(user);
  const session = await ensureSession(normalizedUser.id);
  const localNow = userNow(normalizedUser.timezone);
  const allowed = isWithinWindow(
    localNow,
    normalizedUser.quietHoursStartMinutes ?? DEFAULT_QUIET_START,
    normalizedUser.quietHoursEndMinutes ?? DEFAULT_QUIET_END
  );

  if (session.state === 'WAITING_ANSWER') {
    const canNotify = normalizedUser.notificationsEnabled && allowed;
    await handleReminders(normalizedUser, session, canNotify);
    return;
  }

  if (session.state === 'WAITING_GRADE') {
    return;
  }

  if (!normalizedUser.notificationsEnabled) return;
  if (!allowed) return;

  if (session.state !== 'IDLE') return;

  const now = nowUtc();
  const newReview = await findDueReviewByStage(normalizedUser.id, 0, now);
  const review = newReview ?? await findDueReview(normalizedUser.id, now);
  if (!review || !review.word) return;

  // First exposure of a brand-new card (stage 0, never reviewed) should arrive ASAP once due.
  // After the first answer, user rhythm applies to all following sends.
  const isFirstStageZeroExposure = review.stage === 0 && !review.lastReviewAt;
  if (!hasDailyNotificationCapacity(normalizedUser)) return;
  if (!isFirstStageZeroExposure && !hasNotificationIntervalElapsed(normalizedUser, now)) return;

  const direction = pickDirection(normalizedUser.directionMode);
  const phrase = direction === 'RU_TO_EN' ? review.word.translationRu : review.word.wordEn;
  const lang = (normalizedUser.language as Lang) || 'ru';
  const hint = buildHint(direction, review.word, (review as any).hardStreak, lang);

  const locked = await setSessionActiveIfIdle(normalizedUser.id, 'WAITING_ANSWER', {
    reviewId: review.id,
    wordId: review.wordId,
    direction,
    sentAt: nowUtc().toDate(),
    reminderStep: 0,
  });

  if (!locked) {
    return;
  }

  try {
    const base = `${t(lang, 'worker.verifyPrompt', { phrase })}\n${t(lang, 'worker.answerPrompt')}`;
    const prompt = hint ? `${base}\n\n${hint}` : base;
    await telegram.sendMessage(Number(normalizedUser.id), prompt, { parse_mode: 'HTML' });
    // Keep helper to allow quick swap during experiments.
    // await sendCard(Number(normalizedUser.id), direction, phrase);
    await registerNotification(normalizedUser);
  } catch (e) {
    console.error('Failed to send card, reverting state', e);
    await setState(normalizedUser.id, 'IDLE');
  }
};

export const tick = async () => {
  const users = await prisma.user.findMany();
  for (const user of users) {
    try {
      await processUser(user);
    } catch (e) {
      console.error('Worker user error', user.id, e);
    }
  }
};

export const startWorker = () => {
  console.log('Scheduler started.');
  cron.schedule('* * * * *', tick);
  void tick();
};

if (require.main === module) {
  startWorker();
}
