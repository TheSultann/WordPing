import 'dotenv/config';
import { escapeHtml } from '../utils/html';
import { t, Lang } from '../i18n';
import cron from 'node-cron';
import { Telegraf } from 'telegraf';
import { prisma } from '../db/client';
import { ensureSession, setState, setSessionActiveIfIdle, asPayload } from '../services/sessionService';
import {
  applyRating,
  findDueFirstExposureStageZeroReview,
  findDueReview,
  findWeakDueReview,
  markSkipped,
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
import { CardDirection, Prisma, ReviewResult } from '../generated/prisma/client';
import { isWithinWindow, nowUtc, startOfUserDay, userNow } from '../utils/time';
import dayjs from 'dayjs';
import {
  resetNotificationCountersIfNeeded,
  ensureUser,
  recordCompletion,
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
  answerText?: string | null;
  payload?: Prisma.JsonValue | null;
};

const BLOCKED_USER_COOLDOWN_MINUTES = 60;
const GRADE_AUTO_CLOSE_MINUTES = 20;
const FILL_BATCH_MIN = 5;
const FILL_BATCH_MAX = 10;
const FILL_LOOKAHEAD_LIMIT = 200;
const DEFAULT_FILL_URGENT_WINDOW_MINUTES = 180;
const blockedUserCooldownUntil = new Map<string, number>();

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
  console.warn(
    `Skip notifications for blocked user ${blockedUserKey(userId)} for ${BLOCKED_USER_COOLDOWN_MINUTES}m (${context}).`
  );
  return true;
};

export const __resetBlockedUserCooldown = () => {
  blockedUserCooldownUntil.clear();
};

export const __setBlockedUserCooldownForTest = (userId: bigint | number, untilMs: number) => {
  blockedUserCooldownUntil.set(blockedUserKey(userId), untilMs);
};

export const __getBlockedUserCooldownSizeForTest = () => blockedUserCooldownUntil.size;

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

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
      try {
        await telegram.sendMessage(Number(user.id), t(lang, 'worker.skipped'), { parse_mode: 'HTML' });
      } catch (error) {
        const handled = await handleBlockedUserSendError(user.id, error, 'skip');
        if (!handled) {
          console.error('Failed to send skip notification', error);
        }
      }
    }
    await setState(BigInt(user.id), 'IDLE');
    return;
  }

  if (diff >= 5 && step === 0 && canNotify) {
    try {
      await telegram.sendMessage(Number(user.id), t(lang, 'worker.reminder'), { parse_mode: 'HTML' });
    } catch (error) {
      const handled = await handleBlockedUserSendError(user.id, error, 'reminder');
      if (!handled) {
        console.error('Failed to send reminder notification', error);
      }
      return;
    }
    await setState(BigInt(user.id), 'WAITING_ANSWER', {
      reviewId: session.reviewId ?? null,
      wordId: session.wordId ?? null,
      direction: session.direction ?? null,
      sentAt: session.sentAt ?? null,
      answerText: session.answerText ?? null,
      reminderStep: 1,
    });
    return;
  }
};

export const handlePendingGrade = async (user: any, session: SessionLike) => {
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

  const wasCorrect = Boolean(asPayload(session.payload)?.correct);
  const rating = wasCorrect ? 'GOOD' : 'HARD';
  const result: ReviewResult = wasCorrect ? 'CORRECT' : 'INCORRECT';
  await applyRating(review, rating, result, session.direction, session.answerText ?? undefined);

  const freshUser = await ensureUser(Number(user.id));
  await recordCompletion(freshUser, wasCorrect);
};

export const processUser = async (user: any) => {
  const normalizedUser = await resetNotificationCountersIfNeeded(user);
  const session = await ensureSession(normalizedUser.id);
  const blockedCooldownActive = isBlockedUserCooldownActive(normalizedUser.id);
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

  if (!normalizedUser.notificationsEnabled) return;
  if (!allowed) return;
  if (blockedCooldownActive) return;

  if (session.state !== 'IDLE') return;

  const now = nowUtc();
  // Priority: 1) first exposure for brand-new cards (stage 0, never reviewed),
  // 2) weak words (hardStreak >= 2), 3) any due card.
  const firstExposureReview = await findDueFirstExposureStageZeroReview(normalizedUser.id, now);
  const review = firstExposureReview
    ?? await findWeakDueReview(normalizedUser.id, now)
    ?? await findDueReview(normalizedUser.id, now);
  if (!review || !review.word) return;

  // First exposure of a brand-new card (stage 0, never reviewed) should arrive ASAP once due.
  // After the first answer, user rhythm applies to all following sends.
  const isFirstStageZeroExposure = review.stage === 0 && !review.lastReviewAt;
  if (!hasDailyNotificationCapacity(normalizedUser)) return;
  if (!isFirstStageZeroExposure && !hasNotificationIntervalElapsed(normalizedUser, now)) return;

  const direction = review.direction;
  const lang = (normalizedUser.language as Lang) || 'ru';
  const answerPromptKey = direction === 'EN_TO_RU'
    ? 'worker.answerPrompt.native'
    : 'worker.answerPrompt.english';

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
      let enLine: string;
      if (!isBlankStage) {
        enLine = escapeHtml(sentence.en).replace(
          new RegExp(`(${escapeRegex(wordEn)})`, 'gi'),
          '<u><b>$1</b></u>'
        );
      } else {
        const regex = new RegExp(escapeRegex(wordEn), 'gi');
        enLine = escapeHtml(sentence.en.replace(regex, '___'));
      }
      const targetKey = lang === 'uz' ? 'worker.answerTarget.uzbek' : 'worker.answerTarget.russian';
      const sentenceBlock = `🗣 ${enLine}`;
      cardText = `${t(lang, 'worker.rememberWord')}\n\n${sentenceBlock}\n${t(lang, targetKey)}`;
    } else {
      // Native -> EN: show native sentence only, never leak English answer.
      const nativeTarget = review.word.translationRu;
      const nativeLine = isBlankStage
        ? escapeHtml(sentence.native.replace(new RegExp(escapeRegex(nativeTarget), 'gi'), '___'))
        : escapeHtml(sentence.native).replace(
          new RegExp(`(${escapeRegex(nativeTarget)})`, 'gi'),
          '<u><b>$1</b></u>'
        );
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
    const row: Array<{ text: string; callback_data: string }> = [{ text: '💡', callback_data: `hint:${review.id}` }];
    if (swapCallback) row.push({ text: '🔄', callback_data: swapCallback });
    const sendOpts: any = { parse_mode: 'HTML', reply_markup: { inline_keyboard: [row] } };
    await telegram.sendMessage(Number(normalizedUser.id), cardText, sendOpts);
    await registerNotification(normalizedUser);
  } catch (e) {
    const handled = await handleBlockedUserSendError(normalizedUser.id, e, 'card');
    if (handled) return;
    console.error('Failed to send card, reverting state', e);
    await setState(normalizedUser.id, 'IDLE');
  }
};

export const tick = async () => {
  pruneBlockedUserCooldown();
  // Only load users who need processing:
  // 1. Active session (WAITING_ANSWER/WAITING_GRADE) — reminders, auto-close
  // 2. Notifications enabled — may need to send a new card
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { session: { state: { in: ['WAITING_ANSWER', 'WAITING_GRADE'] } } },
        { notificationsEnabled: true },
      ],
    },
  });
  for (const user of users) {
    try {
      await processUser(user);
    } catch (e) {
      console.error('Worker user error', user.id, e);
    }
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
      console.error('fillSentences error', word.id, e);
    }
  }
};

export const __fillSentencesForTest = fillSentences;

export const startWorker = () => {
  console.log('Scheduler started.');
  cron.schedule('* * * * *', tick);
  cron.schedule('*/30 * * * *', fillSentences);
  void tick();
};

if (require.main === module) {
  startWorker();
}
