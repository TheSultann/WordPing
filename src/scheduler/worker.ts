import 'dotenv/config';
import { escapeHtml } from '../utils/html';
import { isHintAvailable } from '../utils/hint';
import type { Lang } from '../i18n';
import { t } from '../i18n';
import cron from 'node-cron';
import { Telegraf } from 'telegraf';
import { prisma } from '../db/client';
import { ensureSession, setState, setSessionActiveIfIdle, asPayload } from '../services/sessionService';
import {
  findBestDueReviewForNotification,
  findBestDueReviewsForNotification,
  findDuePendingInitialAutoReview,
  markPendingGradeExpired,
  markSkipped,
  type DueReviewForNotification,
  type DueReviewWithWord,
} from '../services/reviewService';
import {
  findWordsNeedingSentences,
  generateSentences,
  saveSentences,
  appendSentences,
  getSentenceForReview,
  advanceSentenceIndex,
  getSentenceCount,
  toExampleSentenceArray,
  SENTENCES_PER_WORD,
  MIN_SENTENCES_FOR_SWAP,
} from '../services/sentenceService';
import type { CardDirection, SessionState, User, UserSession } from '../generated/prisma/client';
import { Prisma } from '../generated/prisma/client';
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
import { blankTargetInSentence, highlightTargetInSentence } from '../utils/reviewCardText';
import { validateRuntimeEnv } from '../utils/env';
import { createLogger } from '../utils/logger';
import { createRuntimeHealthReporter } from '../utils/runtimeHealth';

validateRuntimeEnv('worker');
const workerLogger = createLogger('worker');
const workerHealth = createRuntimeHealthReporter('worker');

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
  answerText?: string | null;
  payload?: Prisma.JsonValue | null;
};

type DeliverableReview = DueReviewWithWord | DueReviewForNotification;

const BLOCKED_USER_COOLDOWN_MINUTES = 60;
const GRADE_AUTO_CLOSE_MINUTES = 20;
const STALE_NON_REVIEW_SESSION_MINUTES = 30;
const DEFAULT_TICK_USER_CONCURRENCY = 20;
const FILL_BATCH_MIN = 5;
const FILL_BATCH_MAX = 10;
const FILL_LOOKAHEAD_LIMIT = 200;
const DEFAULT_FILL_URGENT_WINDOW_MINUTES = 180;
const blockedUserCooldownUntil = new Map<string, number>();
let tickInProgress = false;
const STALE_NON_REVIEW_STATES: SessionState[] = [
  'ADDING_WORD_WAIT_EN',
  'ADDING_WORD_CONFIRM_TRANSLATION',
  'ADDING_WORD_WAIT_RU_MANUAL',
  'SETTINGS_WAIT_INTERVAL',
  'SETTINGS_WAIT_GOAL',
];

const toBigIntUserId = (userId: bigint | number): bigint =>
  typeof userId === 'bigint' ? userId : BigInt(userId);

const blockedUserKey = (userId: bigint | number): string => toBigIntUserId(userId).toString();

const pruneBlockedUserCooldown = (nowMs: number = Date.now()): void => {
  if (!blockedUserCooldownUntil.size) return;
  for (const [key, until] of blockedUserCooldownUntil.entries()) {
    if (until <= nowMs) {
      blockedUserCooldownUntil.delete(key);
    }
  }
};

const isBlockedUserCooldownActive = (userId: bigint | number): boolean => {
  const nowMs = Date.now();
  pruneBlockedUserCooldown(nowMs);
  const key = blockedUserKey(userId);
  const until = blockedUserCooldownUntil.get(key);
  return Boolean(until && until > nowMs);
};

const markBlockedUserCooldown = (userId: bigint | number): void => {
  const nowMs = Date.now();
  pruneBlockedUserCooldown(nowMs);
  const key = blockedUserKey(userId);
  blockedUserCooldownUntil.set(key, nowMs + BLOCKED_USER_COOLDOWN_MINUTES * 60_000);
};

const isTelegramBlockedByUserError = (error: unknown): boolean => {
  const code = (error as any)?.response?.error_code;
  const description = String((error as any)?.response?.description ?? '').toLowerCase();
  return code === 403 && description.includes('bot was blocked by the user');
};

const handleBlockedUserSendError = async (
  userId: bigint | number,
  error: unknown,
  context: 'card' | 'reminder' | 'skip'
): Promise<boolean> => {
  if (!isTelegramBlockedByUserError(error)) return false;
  markBlockedUserCooldown(userId);
  await setState(toBigIntUserId(userId), 'IDLE');
  workerLogger.warn('skip notifications for blocked user', {
    userId: blockedUserKey(userId),
    cooldownMinutes: BLOCKED_USER_COOLDOWN_MINUTES,
    context,
  });
  return true;
};

export const __resetBlockedUserCooldown = () => {
  blockedUserCooldownUntil.clear();
};

export const __setBlockedUserCooldownForTest = (userId: bigint | number, untilMs: number) => {
  blockedUserCooldownUntil.set(blockedUserKey(userId), untilMs);
};

export const __getBlockedUserCooldownSizeForTest = () => blockedUserCooldownUntil.size;

const readTickUserConcurrency = (): number => {
  const raw = Number.parseInt(process.env.WORKER_TICK_USER_CONCURRENCY ?? '', 10);
  if (!Number.isFinite(raw) || raw < 1 || raw > 100) return DEFAULT_TICK_USER_CONCURRENCY;
  return raw;
};

const hasDailyNotificationCapacity = (user: User) => {
  const limit = user.maxNotificationsPerDay ?? DEFAULT_MAX_NOTIFICATIONS;
  return (user.notificationsSentToday ?? 0) < limit;
};

const hasNotificationIntervalElapsed = (user: User, now: dayjs.Dayjs) => {
  const interval = Math.max(user.notificationIntervalMinutes ?? DEFAULT_NOTIFICATION_INTERVAL, MIN_NOTIFICATION_INTERVAL);
  if (user.lastNotificationAt) {
    const last = dayjs(user.lastNotificationAt);
    if (now.diff(last, 'minute') < interval) return false;
  }
  return true;
};

const registerNotification = async (user: User) => {
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

const canResetStaleNonReviewSession = (session: UserSession, now: dayjs.Dayjs): boolean => {
  if (!STALE_NON_REVIEW_STATES.includes(session.state)) return false;
  return now.diff(dayjs(session.updatedAt), 'minute') >= STALE_NON_REVIEW_SESSION_MINUTES;
};

const buildSessionMatchWhere = (
  userId: bigint | number,
  session: SessionLike,
  state: SessionState,
  extraWhere: Prisma.UserSessionWhereInput = {},
): Prisma.UserSessionWhereInput => {
  const where: Prisma.UserSessionWhereInput = {
    userId: toBigIntUserId(userId),
    state,
    ...extraWhere,
  };

  if (session.reviewId !== undefined) where.reviewId = session.reviewId ?? null;
  if (session.wordId !== undefined) where.wordId = session.wordId ?? null;
  if (session.direction !== undefined) where.direction = session.direction ?? null;
  if (session.sentAt !== undefined) where.sentAt = session.sentAt ?? null;

  return where;
};

const claimReminderDelivery = async (userId: bigint | number, session: SessionLike): Promise<boolean> => {
  const result = await prisma.userSession.updateMany({
    where: buildSessionMatchWhere(userId, session, 'WAITING_ANSWER', {
      reminderStep: session.reminderStep ?? 0,
    }),
    data: {
      reminderStep: 1,
      updatedAt: new Date(),
    },
  });
  return result.count > 0;
};

const rollbackReminderDeliveryClaim = async (userId: bigint | number, session: SessionLike): Promise<void> => {
  await prisma.userSession.updateMany({
    where: buildSessionMatchWhere(userId, session, 'WAITING_ANSWER', {
      reminderStep: 1,
    }),
    data: {
      reminderStep: session.reminderStep ?? 0,
      updatedAt: new Date(),
    },
  });
};

const claimWaitingAnswerForSkip = async (userId: bigint | number, session: SessionLike): Promise<boolean> => {
  const result = await prisma.userSession.updateMany({
    where: buildSessionMatchWhere(userId, session, 'WAITING_ANSWER'),
    data: {
      // Keep the session in WAITING_ANSWER until skip persistence succeeds.
      reviewId: null,
      updatedAt: new Date(),
    },
  });
  return result.count > 0;
};

const rollbackWaitingAnswerSkipClaim = async (userId: bigint | number, session: SessionLike): Promise<void> => {
  await prisma.userSession.updateMany({
    where: buildSessionMatchWhere(userId, { ...session, reviewId: null }, 'WAITING_ANSWER'),
    data: {
      reviewId: session.reviewId ?? null,
      updatedAt: new Date(),
    },
  });
};

const finalizeWaitingAnswerSkipClaim = async (userId: bigint | number, session: SessionLike): Promise<boolean> => {
  const result = await prisma.userSession.updateMany({
    where: buildSessionMatchWhere(userId, { ...session, reviewId: null }, 'WAITING_ANSWER'),
    data: {
      state: 'IDLE',
      reviewId: null,
      wordId: null,
      direction: null,
      sentAt: null,
      reminderStep: 0,
      answerText: null,
      payload: Prisma.DbNull,
      updatedAt: new Date(),
    },
  });
  return result.count > 0;
};

const _buildCardSendOptions = (
  reviewId: number,
  swapCallback: string | null,
  hintEnabled: boolean,
) => {
  const row: Array<{ text: string; callback_data: string }> = [];
  if (hintEnabled) row.push({ text: 'рџ’Ў', callback_data: `hint:${reviewId}` });
  if (swapCallback) row.push({ text: 'рџ”„', callback_data: swapCallback });
  return {
    parse_mode: 'HTML',
    ...(row.length > 0 ? { reply_markup: { inline_keyboard: [row] } } : {}),
  };
};

const sendDueReviewCard = async (
  user: User,
  session: SessionLike,
  review: DeliverableReview,
  now: dayjs.Dayjs,
): Promise<boolean> => {
  const direction = review.direction;
  const lang = (user.language as Lang) || 'ru';
  const shouldAdvanceSentence = review.stage >= 2;

  let nextCardText: string;
  let nextSentenceData = shouldAdvanceSentence ? getSentenceForReview(review.word) : null;
  const nextSentenceCount = shouldAdvanceSentence ? getSentenceCount(review.word) : 0;

  if (nextSentenceData && shouldAdvanceSentence) {
    const { sentence } = nextSentenceData;
    const wordEn = review.word.wordEn;
    const isBlankStage = review.stage >= 7;
    if (direction === 'EN_TO_RU') {
      const enLine = isBlankStage
        ? blankTargetInSentence(sentence.en, wordEn)
        : highlightTargetInSentence(sentence.en, wordEn);
      const targetKey = lang === 'uz' ? 'worker.answerTarget.uzbek' : 'worker.answerTarget.russian';
      const sentenceBlock = `\u{1F5E3} ${enLine}`;
      nextCardText = `${t(lang, 'worker.rememberWord')}\n\n${sentenceBlock}\n${t(lang, targetKey)}`;
    } else {
      const nativeTarget = review.word.translationRu;
      const nativeLine = isBlankStage
        ? blankTargetInSentence(sentence.native, nativeTarget)
        : highlightTargetInSentence(sentence.native, nativeTarget);
      const sentenceBlock = `\u{1F5E3} ${nativeLine}`;
      nextCardText = `${t(lang, 'worker.rememberWord')}\n\n${sentenceBlock}\n${t(lang, 'worker.answerTarget.english')}`;
    }
  } else {
    nextSentenceData = null;
    const phrase = direction === 'RU_TO_EN' ? review.word.translationRu : review.word.wordEn;
    const emphasizedPhrase = `<u><b>${escapeHtml(phrase)}</b></u>`;
    nextCardText = `${t(lang, 'worker.verifyPrompt', { phrase: emphasizedPhrase })}\n${t(lang, 'worker.answerPrompt')}`;
  }

  const nextHintTarget = (direction === 'EN_TO_RU' ? review.word.translationRu : review.word.wordEn).trim();
  const nextHintEnabled = isHintAvailable(nextHintTarget);
  const nextSwapCallback = nextSentenceData && nextSentenceCount >= MIN_SENTENCES_FOR_SWAP
    ? `swap:${review.wordId}:${nextSentenceData.index}`
    : null;
  const nextExistingPayload = asPayload(session.payload) ?? {};
  const nextHintInline = Boolean(nextSentenceData && review.stage >= 7 && direction === 'EN_TO_RU');
  const deliveryPayload = {
    ...nextExistingPayload,
    cardBaseText: nextCardText,
    hintTarget: nextHintTarget,
    hintPresses: 0,
    hintReviewId: review.id,
    swapData: nextSwapCallback,
    hintInline: nextHintInline,
  };

  const deliveryLocked = await setSessionActiveIfIdle(user.id, 'WAITING_ANSWER', {
    reviewId: review.id,
    wordId: review.wordId,
    direction,
    sentAt: now.toDate(),
    reminderStep: 0,
    payload: deliveryPayload,
  });

  if (!deliveryLocked) return false;

  try {
    const row: Array<{ text: string; callback_data: string }> = [];
    if (nextHintEnabled) row.push({ text: '\u{1F4A1}', callback_data: `hint:${review.id}` });
    if (nextSwapCallback) row.push({ text: '\u{1F504}', callback_data: nextSwapCallback });
    const sendOpts = {
      parse_mode: 'HTML' as const,
      ...(row.length > 0 ? { reply_markup: { inline_keyboard: [row] } } : {}),
    };
    await telegram.sendMessage(Number(user.id), nextCardText, sendOpts);

    const postSendTasks: Array<{
      label: string;
      task: Promise<unknown>;
    }> = [
      {
        label: 'register notification',
        task: registerNotification(user),
      },
    ];

    if (nextSentenceData && shouldAdvanceSentence) {
      postSendTasks.push({
        label: 'advance sentence index',
        task: advanceSentenceIndex(review.wordId),
      });
    }

    if (review.initialAutoReviewPending) {
      postSendTasks.push({
        label: 'clear initial auto review flag',
        task: prisma.review.update({
          where: { id: review.id },
          data: { initialAutoReviewPending: false },
        }),
      });
    }

    const postSendResults = await Promise.allSettled(postSendTasks.map((entry) => entry.task));
    for (const [index, result] of postSendResults.entries()) {
      if (result.status === 'rejected') {
        workerLogger.error('post-send card update failed', {
          userId: user.id.toString(),
          reviewId: review.id,
          task: postSendTasks[index]?.label,
          error: result.reason,
        });
      }
    }
    return true;
  } catch (error) {
    const handled = await handleBlockedUserSendError(user.id, error, 'card');
    if (handled) return false;
    workerLogger.error('failed to send card, reverting state', {
      userId: user.id.toString(),
      reviewId: review.id,
      error,
    });
    await setState(user.id, 'IDLE');
    return false;
  }

  /* Legacy implementation kept during refactor
  let cardText: string;
  let sentenceData = review.stage >= 2 ? getSentenceForReview(review.word) : null;
  const sentenceCount = review.stage >= 2 ? getSentenceCount(review.word) : 0;

  if (sentenceData && review.stage >= 2) {
    const { sentence } = sentenceData;
    const wordEn = review.word.wordEn;
    const isBlankStage = review.stage >= 7;
    if (direction === 'EN_TO_RU') {
      const enLine = isBlankStage
        ? blankTargetInSentence(sentence.en, wordEn)
        : highlightTargetInSentence(sentence.en, wordEn);
      const targetKey = lang === 'uz' ? 'worker.answerTarget.uzbek' : 'worker.answerTarget.russian';
      const sentenceBlock = `рџ—Ј ${enLine}`;
      cardText = `${t(lang, 'worker.rememberWord')}\n\n${sentenceBlock}\n${t(lang, targetKey)}`;
    } else {
      const nativeTarget = review.word.translationRu;
      const nativeLine = isBlankStage
        ? blankTargetInSentence(sentence.native, nativeTarget)
        : highlightTargetInSentence(sentence.native, nativeTarget);
      const sentenceBlock = `рџ—Ј ${nativeLine}`;
      cardText = `${t(lang, 'worker.rememberWord')}\n\n${sentenceBlock}\n${t(lang, 'worker.answerTarget.english')}`;
    }

    advanceSentenceIndex(review.wordId).catch(() => { });
  } else {
    sentenceData = null;
    const phrase = direction === 'RU_TO_EN' ? review.word.translationRu : review.word.wordEn;
    const emphasizedPhrase = `<u><b>${escapeHtml(phrase)}</b></u>`;
    cardText = `${t(lang, 'worker.verifyPrompt', { phrase: emphasizedPhrase })}\n${t(lang, 'worker.answerPrompt')}`;
  }

  const hintTarget = (direction === 'EN_TO_RU' ? review.word.translationRu : review.word.wordEn).trim();
  const hintEnabled = isHintAvailable(hintTarget);
  const swapCallback = sentenceData && sentenceCount >= MIN_SENTENCES_FOR_SWAP
    ? `swap:${review.wordId}:${sentenceData.index}`
    : null;
  const existingPayload = asPayload(session.payload) ?? {};
  const hintInline = Boolean(sentenceData && review.stage >= 7 && direction === 'EN_TO_RU');
  const nextPayload = {
    ...existingPayload,
    cardBaseText: cardText,
    hintTarget,
    hintPresses: 0,
    hintReviewId: review.id,
    swapData: swapCallback,
    hintInline,
  };

  const locked = await setSessionActiveIfIdle(user.id, 'WAITING_ANSWER', {
    reviewId: review.id,
    wordId: review.wordId,
    direction,
    sentAt: now.toDate(),
    reminderStep: 0,
    payload: nextPayload,
  });

  if (!locked) return false;

  try {
    await telegram.sendMessage(
      Number(user.id),
      cardText,
      buildCardSendOptions(review.id, swapCallback, hintEnabled),
    );
    await registerNotification(user);
    if (review.initialAutoReviewPending) {
      await prisma.review.update({
        where: { id: review.id },
        data: { initialAutoReviewPending: false },
      });
    }
    return true;
  } catch (error) {
    const handled = await handleBlockedUserSendError(user.id, error, 'card');
    if (handled) return false;
    workerLogger.error('failed to send card, reverting state', {
      userId: user.id.toString(),
      reviewId: review.id,
      error,
    });
    await setState(user.id, 'IDLE');
    return false;
  }
  */
};

export const tryDeliverInitialAutoReview = async (user: User): Promise<boolean> => {
  const normalizedUser = await resetNotificationCountersIfNeeded(user);
  const session = await ensureSession(normalizedUser.id);
  if (session.state !== 'IDLE') return false;

  const blockedCooldownActive = isBlockedUserCooldownActive(normalizedUser.id);
  const localNow = userNow(normalizedUser.timezone);
  const allowed = isWithinWindow(
    localNow,
    normalizedUser.quietHoursStartMinutes ?? DEFAULT_QUIET_START,
    normalizedUser.quietHoursEndMinutes ?? DEFAULT_QUIET_END,
  );

  if (!normalizedUser.notificationsEnabled || !allowed || blockedCooldownActive) return false;
  if (!hasDailyNotificationCapacity(normalizedUser)) return false;

  const now = nowUtc();
  const review = await findDuePendingInitialAutoReview(normalizedUser.id, now);
  if (!review || !review.word) return false;

  return sendDueReviewCard(normalizedUser, session, review, now);
};

export const handleReminders = async (user: User, session: SessionLike, canNotify: boolean) => {
  if (!session.sentAt || !session.reviewId) return;
  const sentAt = dayjs(session.sentAt);
  const now = nowUtc();
  const diff = now.diff(sentAt, 'minute');
  const step = session.reminderStep ?? 0;
  const lang = (user.language as Lang) || 'ru';
  const hasCapacity = hasDailyNotificationCapacity(user);

  if (diff >= 20) {
    const claimed = await claimWaitingAnswerForSkip(user.id, session);
    if (!claimed) return;

    const review = await prisma.review.findUnique({ where: { id: session.reviewId } });
    if (review) {
      try {
        await markSkipped(review);
      } catch (error) {
        workerLogger.error('failed to mark skipped review after timeout', {
          userId: user.id.toString(),
          reviewId: session.reviewId,
          error,
        });
        try {
          await rollbackWaitingAnswerSkipClaim(user.id, session);
        } catch (rollbackError) {
          workerLogger.error('failed to rollback timeout skip claim', {
            userId: user.id.toString(),
            reviewId: session.reviewId,
            error: rollbackError,
          });
        }
        return;
      }
    }

    const finalized = await finalizeWaitingAnswerSkipClaim(user.id, session);
    if (!finalized) return;

    if (canNotify && hasCapacity) {
      try {
        await telegram.sendMessage(Number(user.id), t(lang, 'worker.skipped'), { parse_mode: 'HTML' });
      } catch (error) {
        const handled = await handleBlockedUserSendError(user.id, error, 'skip');
        if (!handled) {
          workerLogger.error('failed to send skip notification', { userId: user.id.toString(), error });
        }
        return;
      }

      try {
        await registerNotification(user);
      } catch (error) {
        workerLogger.error('failed to register skip notification', {
          userId: user.id.toString(),
          reviewId: session.reviewId,
          error,
        });
      }
    }
    return;
  }

  if (diff >= 5 && step === 0 && canNotify && hasCapacity) {
    const claimed = await claimReminderDelivery(user.id, session);
    if (!claimed) return;

    try {
      await telegram.sendMessage(Number(user.id), t(lang, 'worker.reminder'), { parse_mode: 'HTML' });
    } catch (error) {
      const handled = await handleBlockedUserSendError(user.id, error, 'reminder');
      if (!handled) {
        workerLogger.error('failed to send reminder notification', { userId: user.id.toString(), error });
        await rollbackReminderDeliveryClaim(user.id, session);
      }
      return;
    }

    try {
      await registerNotification(user);
    } catch (error) {
      workerLogger.error('failed to register reminder notification', {
        userId: user.id.toString(),
        reviewId: session.reviewId,
        error,
      });
    }
    return;
  }
};

export const handlePendingGrade = async (user: User, session: SessionLike) => {
  const now = nowUtc();
  if (!session.sentAt) {
    await setState(BigInt(user.id), 'WAITING_GRADE', {
      reviewId: session.reviewId ?? null,
      wordId: session.wordId ?? null,
      direction: session.direction ?? null,
      sentAt: now.toDate(),
      reminderStep: session.reminderStep ?? 0,
      answerText: session.answerText ?? null,
      payload: asPayload(session.payload) ?? null,
    });
    return;
  }

  const sentAt = dayjs(session.sentAt);
  if (now.diff(sentAt, 'minute') < GRADE_AUTO_CLOSE_MINUTES) return;

  if (!session.reviewId || !session.direction) {
    await setState(BigInt(user.id), 'IDLE');
    return;
  }

  const claim = await prisma.userSession.updateMany({
    where: {
      userId: BigInt(user.id),
      state: 'WAITING_GRADE',
      reviewId: session.reviewId,
      direction: session.direction,
    },
    data: {
      state: 'IDLE',
      reviewId: null,
      wordId: null,
      direction: null,
      sentAt: null,
      reminderStep: 0,
      answerText: null,
      payload: Prisma.DbNull,
    },
  });
  if (claim.count === 0) return;

  const review = await prisma.review.findUnique({ where: { id: session.reviewId } });
  if (!review) return;

  await markPendingGradeExpired(review, session.direction, session.answerText ?? undefined);
};

export const processUser = async (user: User, preselectedReview?: DeliverableReview | null) => {
  const normalizedUser = await resetNotificationCountersIfNeeded(user);
  let session = await ensureSession(normalizedUser.id);
  const blockedCooldownActive = isBlockedUserCooldownActive(normalizedUser.id);
  const now = nowUtc();
  const localNow = userNow(normalizedUser.timezone);
  const allowed = isWithinWindow(
    localNow,
    normalizedUser.quietHoursStartMinutes ?? DEFAULT_QUIET_START,
    normalizedUser.quietHoursEndMinutes ?? DEFAULT_QUIET_END
  );

  if (session.state === 'WAITING_ANSWER') {
    const canNotify = normalizedUser.notificationsEnabled && allowed && !blockedCooldownActive;
    await handleReminders(normalizedUser, session, canNotify);
    return;
  }

  if (session.state === 'WAITING_GRADE') {
    await handlePendingGrade(normalizedUser, session);
    return;
  }

  if (session.state === 'QUIZ_ACTIVE') {
    return;
  }

  if (session.state !== 'IDLE') {
    if (!canResetStaleNonReviewSession(session, now)) return;
    session = await setState(normalizedUser.id, 'IDLE');
  }

  if (!normalizedUser.notificationsEnabled) return;
  if (!allowed) return;
  if (blockedCooldownActive) return;

  const review = preselectedReview ?? await findBestDueReviewForNotification(normalizedUser.id, now);
  if (!review || !review.word) return;

  // The first auto-review after adding a word should ignore the user's
  // custom interval, but still obey quiet hours and daily limits.
  const isInitialAutoReview = review.initialAutoReviewPending === true;
  if (!hasDailyNotificationCapacity(normalizedUser)) return;
  if (!isInitialAutoReview && !hasNotificationIntervalElapsed(normalizedUser, now)) return;

  await sendDueReviewCard(normalizedUser, session, review, now);
  return;

  /* Legacy implementation kept during refactor
  const direction = review.direction;
  const lang = (normalizedUser.language as Lang) || 'ru';

  // Build card text based on stage
  let cardText: string;
  let sentenceData = review.stage >= 2 ? getSentenceForReview(review.word) : null;
  const sentenceCount = review.stage >= 2 ? getSentenceCount(review.word) : 0;

  if (sentenceData && review.stage >= 2) {
    const { sentence } = sentenceData;
    const wordEn = review.word.wordEn;
    const isBlankStage = review.stage >= 7;
    if (direction === 'EN_TO_RU') {
      // EN -> native: work from English sentence context.
      const enLine = isBlankStage
        ? blankTargetInSentence(sentence.en, wordEn)
        : highlightTargetInSentence(sentence.en, wordEn);
      const targetKey = lang === 'uz' ? 'worker.answerTarget.uzbek' : 'worker.answerTarget.russian';
      const sentenceBlock = `🗣 ${enLine}`;
      cardText = `${t(lang, 'worker.rememberWord')}\n\n${sentenceBlock}\n${t(lang, targetKey)}`;
    } else {
      // Native -> EN: show native sentence only, never leak English answer.
      const nativeTarget = review.word.translationRu;
      const nativeLine = isBlankStage
        ? blankTargetInSentence(sentence.native, nativeTarget)
        : highlightTargetInSentence(sentence.native, nativeTarget);
      const sentenceBlock = `🗣 ${nativeLine}`;
      cardText = `${t(lang, 'worker.rememberWord')}\n\n${sentenceBlock}\n${t(lang, 'worker.answerTarget.english')}`;
    }

    // Advance sentence index for next time (fire-and-forget)
    advanceSentenceIndex(review.wordId).catch(() => { });
  } else {
    sentenceData = null; // ensure null for classic card path
    // Classic word card (stage 0-1 or no sentences)
    const phrase = direction === 'RU_TO_EN' ? review.word.translationRu : review.word.wordEn;
    const emphasizedPhrase = `<u><b>${escapeHtml(phrase)}</b></u>`;
    cardText = `${t(lang, 'worker.verifyPrompt', { phrase: emphasizedPhrase })}\n${t(lang, 'worker.answerPrompt')}`;
  }

  const hintTarget = (direction === 'EN_TO_RU' ? review.word.translationRu : review.word.wordEn).trim();
  const hintEnabled = isHintAvailable(hintTarget);
  const swapCallback = sentenceData && sentenceCount >= MIN_SENTENCES_FOR_SWAP
    ? `swap:${review.wordId}:${sentenceData.index}`
    : null;
  const existingPayload = asPayload(session.payload) ?? {};
  const hintInline = Boolean(sentenceData && review.stage >= 7 && direction === 'EN_TO_RU');
  const nextPayload = {
    ...existingPayload,
    cardBaseText: cardText,
    hintTarget,
    hintPresses: 0,
    hintReviewId: review.id,
    swapData: swapCallback,
    hintInline,
  };

  const locked = await setSessionActiveIfIdle(normalizedUser.id, 'WAITING_ANSWER', {
    reviewId: review.id,
    wordId: review.wordId,
    direction,
    sentAt: nowUtc().toDate(),
    reminderStep: 0,
    payload: nextPayload,
  });

  if (!locked) {
    return;
  }

  try {
    const row: Array<{ text: string; callback_data: string }> = [];
    if (hintEnabled) row.push({ text: '💡', callback_data: `hint:${review.id}` });
    if (swapCallback) row.push({ text: '🔄', callback_data: swapCallback });
    const sendOpts: any = {
      parse_mode: 'HTML',
      ...(row.length > 0 ? { reply_markup: { inline_keyboard: [row] } } : {}),
    };
    await telegram.sendMessage(Number(normalizedUser.id), cardText, sendOpts);
    await registerNotification(normalizedUser);
    if (isInitialAutoReview) {
      await prisma.review.update({
        where: { id: review.id },
        data: { initialAutoReviewPending: false },
      });
    }
  } catch (e) {
    const handled = await handleBlockedUserSendError(normalizedUser.id, e, 'card');
    if (handled) return;
    workerLogger.error('failed to send card, reverting state', {
      userId: normalizedUser.id.toString(),
      reviewId: review.id,
      error: e,
    });
    await setState(normalizedUser.id, 'IDLE');
  }
  */
};

export const tick = async () => {
  if (tickInProgress) {
    workerLogger.warn('tick skipped because previous run is still active');
    return;
  }

  tickInProgress = true;
  try {
    pruneBlockedUserCooldown();
    const now = nowUtc();
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { session: { state: { in: ['WAITING_ANSWER', 'WAITING_GRADE'] } } },
          { session: { state: { in: STALE_NON_REVIEW_STATES } } },
          {
            notificationsEnabled: true,
            reviews: {
              some: {
                nextReviewAt: { lte: now.toDate() },
              },
            },
          },
        ],
      },
      orderBy: { id: 'asc' },
    });

    const bestDueReviewsByUserId = await findBestDueReviewsForNotification(
      users.map((user) => user.id),
      now,
    );

    const concurrency = readTickUserConcurrency();
    for (let index = 0; index < users.length; index += concurrency) {
      const batch = users.slice(index, index + concurrency);
      await Promise.all(batch.map(async (user) => {
        try {
          await processUser(user, bestDueReviewsByUserId.get(user.id.toString()) ?? null);
        } catch (e) {
          workerLogger.error('worker user processing failed', { userId: user.id.toString(), error: e });
        }
      }));
    }
  } finally {
    tickInProgress = false;
  }
};

type FillQueueItem = Awaited<ReturnType<typeof findWordsNeedingSentences>>[number] & {
  sentenceCount: number;
  missing: number;
  tier: number;
};

const readFillUrgentWindowMinutes = (): number => {
  const raw = Number.parseInt(process.env.FILL_SENTENCES_URGENT_WINDOW_MINUTES ?? '', 10);
  if (!Number.isFinite(raw) || raw < 10 || raw > 1440) return DEFAULT_FILL_URGENT_WINDOW_MINUTES;
  return raw;
};

const resolveFillWindow = (word: Awaited<ReturnType<typeof findWordsNeedingSentences>>[number]) => ({
  start: word.user.quietHoursStartMinutes ?? DEFAULT_QUIET_START,
  end: word.user.quietHoursEndMinutes ?? DEFAULT_QUIET_END,
});

const isAlwaysOnWindowForFill = (word: Awaited<ReturnType<typeof findWordsNeedingSentences>>[number]): boolean => {
  const { start, end } = resolveFillWindow(word);
  return start === end;
};

const isUserInQuietHoursForFill = (word: Awaited<ReturnType<typeof findWordsNeedingSentences>>[number]): boolean => {
  const { start, end } = resolveFillWindow(word);
  const localNow = userNow(word.user.timezone);
  const activeWindow = isWithinWindow(
    localNow,
    start,
    end
  );
  return !activeWindow;
};

const resolveFillBatchSize = (queueSize: number): number => {
  if (queueSize <= 0) return 0;
  const dynamic = Math.max(FILL_BATCH_MIN, Math.ceil(queueSize / 2));
  const capped = Math.min(FILL_BATCH_MAX, dynamic);
  return Math.min(queueSize, capped);
};

const buildFillQueue = (
  words: Awaited<ReturnType<typeof findWordsNeedingSentences>>,
): FillQueueItem[] => {
  const urgentWindowMs = readFillUrgentWindowMinutes() * 60_000;
  const nowMs = Date.now();
  const queue: FillQueueItem[] = [];

  for (const word of words) {
    const sentenceCount = toExampleSentenceArray(word.exampleSentences ?? null).length;
    const missing = Math.max(0, SENTENCES_PER_WORD - sentenceCount);
    if (missing <= 0) continue;

    const inQuietHours = isUserInQuietHoursForFill(word);
    const createdAtMs = word.createdAt.getTime();
    const ageMs = Math.max(0, nowMs - createdAtMs);
    const isFresh = ageMs <= urgentWindowMs;
    const isUrgent = sentenceCount === 0 && isFresh;
    const allowBacklogMode = inQuietHours || isAlwaysOnWindowForFill(word);

    if (!allowBacklogMode && !isUrgent) {
      // Day mode: only urgent words (just added with 0 examples)
      continue;
    }

    // Quiet-hours priority:
    // 0) backlog with 0 examples, 1) backlog with 1-2 examples, 2) fresh words.
    // Daytime urgent words are handled after quiet-hours backlog.
    const tier = allowBacklogMode
      ? (!isUrgent && sentenceCount === 0 ? 0 : !isUrgent ? 1 : 2)
      : 3;

    queue.push({
      ...word,
      sentenceCount,
      missing,
      tier,
    });
  }

  return queue.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.tier === 3) {
      // Day urgent queue: newest first.
      return b.createdAt.getTime() - a.createdAt.getTime();
    }
    // Quiet queue: oldest first.
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
};

const fillSentences = async () => {
  const words = await findWordsNeedingSentences(FILL_LOOKAHEAD_LIMIT);
  if (!words.length) return;
  const queue = buildFillQueue(words);
  if (!queue.length) return;
  const batchSize = resolveFillBatchSize(queue.length);
  const batch = queue.slice(0, batchSize);

  for (const word of batch) {
    try {
      const userLang = (word.user.language === 'uz' ? 'uz' : 'ru') as 'ru' | 'uz';
      const existing = toExampleSentenceArray(word.exampleSentences ?? null);
      const missing = word.missing;
      if (missing <= 0) continue;
      const sentences = await generateSentences(word.wordEn, word.translationRu, userLang, {
        count: missing,
        avoidEnglish: existing.map((item) => item.en),
      });
      if (sentences) {
        if (existing.length === 0) {
          await saveSentences(word.id, sentences);
        } else {
          await appendSentences(word.id, sentences, SENTENCES_PER_WORD);
        }
      }
    } catch (e) {
      workerLogger.error('fillSentences failed', { wordId: word.id, error: e });
    }
  }
};

export const __fillSentencesForTest = fillSentences;

export const startWorker = () => {
  workerHealth.start();
  workerHealth.markOk('worker started');
  workerLogger.info('Scheduler started.');
  workerLogger.info('worker cron configured', {
    tickCron: '* * * * *',
    fillSentencesCron: '*/30 * * * *',
  });
  cron.schedule('* * * * *', () => {
    void tick()
      .then(() => workerHealth.markTask('tick', 'ok'))
      .catch((error) => {
        workerHealth.markTask('tick', 'error', error instanceof Error ? error.message : 'tick failed');
        workerLogger.error('tick fatal error', { error });
      });
  });
  cron.schedule('*/30 * * * *', () => {
    void fillSentences()
      .then(() => workerHealth.markTask('fillSentences', 'ok'))
      .catch((error) => {
        workerHealth.markTask('fillSentences', 'error', error instanceof Error ? error.message : 'fillSentences failed');
        workerLogger.error('fillSentences fatal error', { error });
      });
  });
  void tick()
    .then(() => workerHealth.markTask('tick', 'ok'))
    .catch((error) => {
      workerHealth.markTask('tick', 'error', error instanceof Error ? error.message : 'tick failed');
      workerLogger.error('tick fatal error', { error });
    });
};

if (require.main === module) {
  startWorker();
}
