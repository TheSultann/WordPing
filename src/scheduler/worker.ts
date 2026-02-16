import 'dotenv/config';
import { t, Lang } from '../i18n';
import cron from 'node-cron';
import { Telegraf } from 'telegraf';
import { prisma } from '../db/client';
import { ensureSession, setState, setSessionActiveIfIdle } from '../services/sessionService';
import { findDueReview, markSkipped, pickDirection } from '../services/reviewService';
import { CardDirection } from '../generated/prisma';
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

const canSendNotification = (user: any, now: dayjs.Dayjs) => {
  const interval = Math.max(user.notificationIntervalMinutes ?? DEFAULT_NOTIFICATION_INTERVAL, MIN_NOTIFICATION_INTERVAL);
  if (user.lastNotificationAt) {
    const last = dayjs(user.lastNotificationAt);
    if (now.diff(last, 'minute') < interval) return false;
  }
  const limit = user.maxNotificationsPerDay ?? DEFAULT_MAX_NOTIFICATIONS;
  return (user.notificationsSentToday ?? 0) < limit;
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
  const prompt = `Переведи: ${phrase}\n(Ответь сообщением)`;
  await telegram.sendMessage(userId, prompt);
};

export const handleReminders = async (user: any, session: SessionLike, canNotify: boolean) => {
  if (!session.sentAt || !session.reviewId) return;
  const sentAt = dayjs(session.sentAt);
  const now = nowUtc();
  const diff = now.diff(sentAt, 'minute');
  const step = session.reminderStep ?? 0;
  const lang = (user.language as Lang) || 'ru';

  // Skip after 20 minutes (total time from sentAt)
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

  // 1. Reminder after 5 minutes
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
  let normalizedUser = await resetNotificationCountersIfNeeded(user);
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
    return; // wait for user grade
  }

  if (!normalizedUser.notificationsEnabled) return;
  if (!allowed) return;

  if (session.state !== 'IDLE') return;

  const now = nowUtc();
  if (!canSendNotification(normalizedUser, now)) return;

  const review = await findDueReview(normalizedUser.id, now);
  if (!review || !review.word) {
    console.log(`User ${user.id}: No due reviews`);
    return;
  }

  const direction = pickDirection(normalizedUser.directionMode);
  const phrase = direction === 'RU_TO_EN' ? review.word.translationRu : review.word.wordEn;

  // OPTIMISTIC LOCK: Only proceed if we can transition from IDLE atomically
  const locked = await setSessionActiveIfIdle(normalizedUser.id, 'WAITING_ANSWER', {
    reviewId: review.id,
    wordId: review.wordId,
    direction,
    sentAt: nowUtc().toDate(),
    reminderStep: 0,
  });

  if (!locked) {
    // User became busy (e.g. started /add flow) in the ms between check and update.
    // Abort silently, we'll try again next tick if they become IDLE.
    return;
  }

  // If locked successfully, send the message
  try {
    const lang = (normalizedUser.language as Lang) || 'ru';
    const prompt = `${t(lang, 'worker.verifyPrompt', { phrase })}\n${t(lang, 'worker.answerPrompt')}`;
    await telegram.sendMessage(Number(normalizedUser.id), prompt, { parse_mode: 'HTML' });
    // await sendCard(Number(normalizedUser.id), direction, phrase); // Replaced inline for localization
    await registerNotification(normalizedUser);
  } catch (e) {
    // If sending fails, revert state to IDLE so we don't get stuck
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
