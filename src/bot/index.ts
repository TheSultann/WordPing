import 'dotenv/config';
import { escapeHtml } from '../utils/html';
import { Context, Markup, Telegraf } from 'telegraf';
import {
  ensureUser,
  type TelegramProfile,
  recordCompletion,
  setNotifications,
  setQuietHours,
  setNotificationLimit,
  setNotificationInterval,
  setLanguage,
  setReferredByIfEmpty,
} from '../services/userService';
import { prisma } from '../db/client';
import { ensureSession, getSession, resetState, setState } from '../services/sessionService';
import {
  suggestTranslation,
  detectLanguageWithMeta,
  isSuspiciousAutoTranslation,
  translateAuto,
  detectAndTranslateWithGemini,
  translateAutoWithMyMemory,
} from '../services/translation';
import { addWordForUser, applyRating, loadReviewWithWord, DailyWordLimitError, DuplicateWordError } from '../services/reviewService';
import { generateSentences, saveSentences, removeSentenceAtIndex, getSentenceForReview, getSentenceCount, MIN_SENTENCES_FOR_SWAP } from '../services/sentenceService';
import { checkAutoTranslateQuota, commitAutoTranslateQuota } from '../services/translationQuota';
import { CardDirection, Prisma, QuizRunStatus, ReviewResult } from '../generated/prisma/client';
import { checkAnswer } from '../services/answerChecker';
import { Rating } from '../services/reviewScheduler';
import { buildUserNewsDigest, type NewsDigestItem } from '../services/newsFallbackService';
import {
  QUIZ_DAILY_LIMIT,
  QUIZ_TIME_LIMIT_SECONDS,
  finishQuiz,
  getCurrentQuestion,
  startOrResumeQuiz,
  submitAnswer,
  type QuizQuestionView,
  type SubmitQuizAnswerResult,
  type QuizSummary,
} from '../services/quizService';
import { minutesToTimeString } from '../utils/time';
import { normalizeWhitespace } from '../utils/text';
import {
  MIN_NOTIFICATION_INTERVAL,
  DEFAULT_MAX_NOTIFICATIONS,
  MAX_NOTIFICATIONS_PER_DAY,
  MIN_NOTIFICATIONS_PER_DAY,
  MAX_NOTIFICATION_INTERVAL,
} from '../services/userService';
import { blankTargetInSentence, highlightTargetInSentence } from '../utils/reviewCardText';
import { t, hasLang, Lang } from '../i18n';

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error('BOT_TOKEN is not set');
}

const bot = new Telegraf(token);

const gradeKeyboard = Markup.inlineKeyboard([
  [
    Markup.button.callback('Hard', 'grade:HARD'),
    Markup.button.callback('Good', 'grade:GOOD'),
    Markup.button.callback('Easy', 'grade:EASY'),
  ],
]);

const confirmKeyboard = (lang: Lang) => Markup.inlineKeyboard([
  [Markup.button.callback(t(lang, 'btn.confirmOk'), 'add_confirm'), Markup.button.callback(t(lang, 'btn.confirmEdit'), 'add_change')],
  [Markup.button.callback(t(lang, 'btn.cancel'), 'add_cancel')],
]);

const rawWebAppUrl = (process.env.WEBAPP_URL ?? '').trim();
const parseHttpsUrl = (value: string): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};
const webAppUrl = parseHttpsUrl(rawWebAppUrl);
const webAppUnavailableText = rawWebAppUrl
  ? 'WEBAPP_URL must be HTTPS (Telegram does not allow http://).'
  : 'WEBAPP_URL is not set';
if (rawWebAppUrl && !webAppUrl) {
  console.warn('[bot] WEBAPP_URL ignored because it is not HTTPS:', rawWebAppUrl);
}
const webAppLabel = (lang: Lang) => (lang === 'uz' ? 'Ilova' : 'Приложение');
const NEWS_DIGEST_BUTTON_BY_LANG: Record<Lang, string> = {
  ru: '\u{1F4F0} \u041F\u043E\u0447\u0438\u0442\u0430\u0442\u044C \u043D\u043E\u0432\u043E\u0441\u0442\u0438',
  uz: '\u{1F4F0} Yangiliklarni o\u2018qish',
};
const NEWS_DIGEST_BUTTONS = Object.values(NEWS_DIGEST_BUTTON_BY_LANG);
const NEWS_DIGEST_CARD_TITLE_BY_LANG: Record<Lang, string> = {
  ru: '\u{1F4F0} \u041D\u043E\u0432\u043E\u0441\u0442\u044C \u0434\u043D\u044F',
  uz: '\u{1F4F0} Kun yangiligi',
};
const NEWS_READ_FULL_LABEL_BY_LANG: Record<Lang, string> = {
  ru: '\u0427\u0438\u0442\u0430\u0442\u044C \u043E\u0440\u0438\u0433\u0438\u043D\u0430\u043B',
  uz: 'To\u2018liq o\u2018qish',
};
const NEWS_SOURCE_LABEL_BY_LANG: Record<Lang, string> = {
  ru: '\u0418\u0441\u0442\u043E\u0447\u043D\u0438\u043A',
  uz: 'Manba',
};
const NEWS_DIGEST_FALLBACK_TEXT_BY_LANG: Record<Lang, string> = {
  ru: '\u{1F4F0} \u041F\u043E\u043A\u0430 \u043D\u0435\u0442 \u0433\u043E\u0442\u043E\u0432\u044B\u0445 \u043D\u043E\u0432\u043E\u0441\u0442\u043D\u044B\u0445 \u043F\u0440\u0438\u043C\u0435\u0440\u043E\u0432. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0447\u0443\u0442\u044C \u043F\u043E\u0437\u0436\u0435.',
  uz: '\u{1F4F0} Hozircha tayyor yangilik namunalar yo\u2018q. Birozdan keyin urinib ko\u2018ring.',
};
const NEWS_DIGEST_STALE_TEXT_BY_LANG: Record<Lang, string> = {
  ru: '\u0414\u0430\u0439\u0434\u0436\u0435\u0441\u0442 \u0443\u0441\u0442\u0430\u0440\u0435\u043B, \u043E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u043D\u043E\u0432\u043E\u0441\u0442\u0438 \u0441\u043D\u043E\u0432\u0430',
  uz: 'Dayjest eskirdi, yangiliklarni qayta oching',
};
const NEWS_NAV_PREV_CALLBACK = 'newsnav:prev';
const NEWS_NAV_NEXT_CALLBACK = 'newsnav:next';
const NEWS_NAV_NOOP_CALLBACK = 'newsnav:noop';
const NEWS_NAV_PREV_LABEL_BY_LANG: Record<Lang, string> = {
  ru: '⬅️ Назад',
  uz: '⬅️ Orqaga',
};
const NEWS_NAV_NEXT_LABEL_BY_LANG: Record<Lang, string> = {
  ru: 'Вперёд ➡️',
  uz: 'Oldinga ➡️',
};

const QUIZ_BUTTON_BY_LANG: Record<Lang, string> = {
  ru: '\u{1F9E0} Quiz',
  uz: '\u{1F9E0} Quiz',
};
const QUIZ_BUTTONS = Object.values(QUIZ_BUTTON_BY_LANG);
const QUIZ_CALLBACK_ANSWER_PREFIX = 'quiz:answer:';
const QUIZ_CALLBACK_SKIP_PREFIX = 'quiz:skip:';
const QUIZ_CALLBACK_NEXT_PREFIX = 'quiz:next:';
const QUIZ_CALLBACK_EXIT_PREFIX = 'quiz:exit:';

type QuizRunSnapshot = {
  id: number;
  status: QuizRunStatus;
  totalQuestions: number;
  currentIndex: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  startedAt: Date;
  durationSeconds: number | null;
};

const parsePositiveInt = (value: string | undefined): number | null => {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

const parseNonNegativeInt = (value: string | undefined): number | null => {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
};

const quizAnswerCallback = (runId: number, questionId: number, optionIndex: number) =>
  `${QUIZ_CALLBACK_ANSWER_PREFIX}${runId}:${questionId}:${optionIndex}`;
const quizSkipCallback = (runId: number, questionId: number) =>
  `${QUIZ_CALLBACK_SKIP_PREFIX}${runId}:${questionId}`;
const quizNextCallback = (runId: number) => `${QUIZ_CALLBACK_NEXT_PREFIX}${runId}`;
const quizExitCallback = (runId: number) => `${QUIZ_CALLBACK_EXIT_PREFIX}${runId}`;

type NewsDigestNavItem = Pick<NewsDigestItem, 'wordId' | 'wordEn' | 'translation' | 'highlightedText' | 'sourceUrl' | 'sourceTitle'>;

const isNewsDigestNavItem = (value: unknown): value is NewsDigestNavItem => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.wordId === 'number' &&
    typeof item.wordEn === 'string' &&
    typeof item.highlightedText === 'string' &&
    (item.translation === null || typeof item.translation === 'string') &&
    (item.sourceUrl === null || typeof item.sourceUrl === 'string') &&
    (item.sourceTitle === undefined || item.sourceTitle === null || typeof item.sourceTitle === 'string')
  );
};

const newsDigestInlineKeyboard = (lang: Lang, index: number, total: number) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback(NEWS_NAV_PREV_LABEL_BY_LANG[lang], NEWS_NAV_PREV_CALLBACK),
      Markup.button.callback(`${Math.max(1, index + 1)} / ${Math.max(1, total)}`, NEWS_NAV_NOOP_CALLBACK),
      Markup.button.callback(NEWS_NAV_NEXT_LABEL_BY_LANG[lang], NEWS_NAV_NEXT_CALLBACK),
    ],
  ]);

const renderNewsDigestCard = (lang: Lang, item: NewsDigestNavItem): string => {
  const translationPart = item.translation?.trim() ? ` - ${escapeHtml(item.translation.trim())}` : '';
  const context = item.highlightedText;
  const sourceLine = item.sourceUrl
    ? `\n\n🔗 <a href="${escapeHtml(item.sourceUrl)}">${escapeHtml(NEWS_READ_FULL_LABEL_BY_LANG[lang])}</a>`
    : (item.sourceTitle?.trim()
      ? `\n\n🔎 ${escapeHtml(NEWS_SOURCE_LABEL_BY_LANG[lang])}: ${escapeHtml(item.sourceTitle.trim())}`
      : '');
  return `<b>${NEWS_DIGEST_CARD_TITLE_BY_LANG[lang]}</b>\n\n💡 <b>${escapeHtml(item.wordEn)}</b>${translationPart}\n\n${context}${sourceLine}`;
};


const quizTaskLabel = (lang: Lang, question: QuizQuestionView): string => {
  if (question.mode === 'TRUE_FALSE') {
    return lang === 'uz' ? 'Moslik to‘g‘rimi?' : 'Верно ли соответствие?';
  }
  if (question.mode === 'FILL_GAP') {
    return lang === 'uz' ? 'Bo‘sh joyni to‘ldiring:' : 'Заполни пропуск:';
  }
  if (question.direction === 'EN_TO_RU') {
    return lang === 'uz' ? 'Tarjimani tanlang:' : 'Выбери перевод:';
  }
  return lang === 'uz' ? 'Inglizcha so‘zni tanlang:' : 'Выбери английское слово:';
};

const quizQuestionText = (lang: Lang, question: QuizQuestionView): string => {
  const questionNumber = question.questionIndex + 1;
  const progress = quizProgressBar(questionNumber - 1, question.totalQuestions);
  const lines = [
    `🧠 <b>${lang === 'uz' ? 'Savol' : 'Вопрос'} ${questionNumber}/${question.totalQuestions}</b>  ⏱ ${QUIZ_TIME_LIMIT_SECONDS}${lang === 'uz' ? 's' : 'с'}`,
    progress,
    '',
    `<b>${escapeHtml(quizTaskLabel(lang, question))}</b>`,
    `💬 <code>${escapeHtml(question.promptText)}</code>`,
  ];
  return lines.join('\n');
};

const quizQuestionKeyboard = (lang: Lang, question: QuizQuestionView) => {
  const rows: Array<Array<ReturnType<typeof Markup.button.callback>>> = [];
  if (question.mode === 'TRUE_FALSE') {
    rows.push([
      Markup.button.callback(lang === 'uz' ? '✅ To‘g‘ri' : '✅ Верно', quizAnswerCallback(question.runId, question.questionId, 0)),
      Markup.button.callback(lang === 'uz' ? '❌ Noto‘g‘ri' : '❌ Неверно', quizAnswerCallback(question.runId, question.questionId, 1)),
    ]);
  } else {
    const options = question.options ?? [];
    for (let index = 0; index < options.length; index += 2) {
      const left = options[index];
      const right = options[index + 1];
      const row: Array<ReturnType<typeof Markup.button.callback>> = [];
      if (left) {
        row.push(Markup.button.callback(left, quizAnswerCallback(question.runId, question.questionId, index)));
      }
      if (right) {
        row.push(Markup.button.callback(right, quizAnswerCallback(question.runId, question.questionId, index + 1)));
      }
      if (row.length) rows.push(row);
    }
  }

  rows.push([
    Markup.button.callback(lang === 'uz' ? 'O‘tkazish' : 'Пропуск', quizSkipCallback(question.runId, question.questionId)),
    Markup.button.callback(lang === 'uz' ? 'Chiqish' : 'Выйти', quizExitCallback(question.runId)),
  ]);
  return Markup.inlineKeyboard(rows);
};

const quizAfterAnswerKeyboard = (lang: Lang, runId: number, hasNext: boolean) => {
  const rows: Array<Array<ReturnType<typeof Markup.button.callback>>> = [];
  if (hasNext) {
    rows.push([Markup.button.callback(lang === 'uz' ? 'Keyingi savol' : 'Следующий вопрос', quizNextCallback(runId))]);
  }
  rows.push([Markup.button.callback(lang === 'uz' ? 'Chiqish' : 'Выйти', quizExitCallback(runId))]);
  return Markup.inlineKeyboard(rows);
};

const quizAccuracy = (correctCount: number, totalQuestions: number): number => {
  if (!Number.isFinite(totalQuestions) || totalQuestions <= 0) return 0;
  return Math.round((correctCount / totalQuestions) * 100);
};

const quizSummaryText = (lang: Lang, summary: QuizSummary): string => {
  const statusText = summary.status === 'ABANDONED'
    ? (lang === 'uz' ? 'Toxtatildi' : 'Прерван')
    : (lang === 'uz' ? 'Yakunlandi' : 'Завершен');
  const durationLabel = summary.durationSeconds === null ? '-' : `${summary.durationSeconds}s`;

  return [
    `<b>\u{1F9E0} Quiz ${statusText}</b>`,
    '',
    `${lang === 'uz' ? 'Natija' : 'Результат'}: <b>${summary.correctCount}/${summary.totalQuestions}</b>`,
    `${lang === 'uz' ? 'Aniqlik' : 'Точность'}: <b>${summary.accuracyPercent}%</b>`,
    `${lang === 'uz' ? 'Xato' : 'Ошибок'}: <b>${summary.wrongCount}</b>`,
    `${lang === 'uz' ? 'Propusk' : 'Пропусков'}: <b>${summary.skippedCount}</b>`,
    `${lang === 'uz' ? 'Davomiylik' : 'Длительность'}: <b>${durationLabel}</b>`,
  ].join('\n');
};

const quizAnswerResultText = (lang: Lang, result: Extract<SubmitQuizAnswerResult, { ok: true }>): string => {
  const statusLine = result.outcome === 'CORRECT'
    ? (lang === 'uz' ? '✅ To‘g‘ri' : '✅ Верно')
    : result.outcome === 'WRONG'
      ? (lang === 'uz' ? `❌ Noto‘g‘ri. To‘g‘ri javob: ${escapeHtml(result.correctAnswer)}` : `❌ Неверно. Правильный ответ: ${escapeHtml(result.correctAnswer)}`)
      : result.timedOut
        ? (lang === 'uz' ? '⏱ Vaqt tugadi, o‘tkazildi' : '⏱ Время вышло, засчитан пропуск')
        : (lang === 'uz' ? '⏭ O‘tkazildi' : '⏭ Пропуск');
  const progress = result.summary
    ? `${lang === 'uz' ? 'Jarayon' : 'Прогресс'}: <b>${result.summary.correctCount + result.summary.wrongCount + result.summary.skippedCount}/${result.summary.totalQuestions}</b>`
    : '';
  const accuracy = result.summary
    ? `${lang === 'uz' ? 'Aniqlik' : 'Точность'}: <b>${result.summary.accuracyPercent}%</b>`
    : '';
  return ['<b>\u{1F9E0} Quiz</b>', statusLine, progress, accuracy].filter(Boolean).join('\n');
};

const quizLimitReachedText = (lang: Lang, usedToday: number): string =>
  lang === 'uz'
    ? `Bugungi Quiz limiti tugadi: ${QUIZ_DAILY_LIMIT}. Ishlatildi: ${usedToday}/${QUIZ_DAILY_LIMIT}.`
    : `Дневной лимит Quiz исчерпан: ${usedToday}/${QUIZ_DAILY_LIMIT}.`;

const quizInsufficientWordsText = (lang: Lang, minRequiredWords: number): string =>
  lang === 'uz'
    ? `Quiz uchun kamida ${minRequiredWords} ta stage>=2 soz kerak.`
    : `Для Quiz нужно минимум ${minRequiredWords} слов со stage>=2.`;

const quizBusyStateText = (lang: Lang): string =>
  lang === 'uz'
    ? 'Avval joriy review kartani tugating.'
    : 'Сначала завершите текущую review-карточку.';

const quizUseButtonsText = (lang: Lang): string =>
  lang === 'uz'
    ? 'Quiz aktiv. Javobni tugmalar bilan bering.'
    : 'Quiz активен. Отвечайте кнопками.';

const quizUnavailableText = (lang: Lang): string =>
  lang === 'uz'
    ? 'Quiz vaqtincha mavjud emas. Keyinroq qayta urinib koring.'
    : 'Quiz временно недоступен. Попробуйте позже.';

const quizAlreadyHandledText = (lang: Lang, stale: boolean): string => {
  if (stale) return lang === 'uz' ? 'Bu savol allaqachon yopilgan.' : 'Этот вопрос уже закрыт.';
  return lang === 'uz' ? 'Javob allaqachon qabul qilingan.' : 'Ответ уже принят.';
};

const isQuizSchemaMissingError = (error: unknown): boolean => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return error.code === 'P2021' || error.code === 'P2022';
};

const loadQuizRunSnapshot = async (userId: bigint, runId: number): Promise<QuizRunSnapshot | null> => {
  return prisma.quizRun.findFirst({
    where: { id: runId, userId },
    select: {
      id: true,
      status: true,
      totalQuestions: true,
      currentIndex: true,
      correctCount: true,
      wrongCount: true,
      skippedCount: true,
      startedAt: true,
      durationSeconds: true,
    },
  });
};

const toQuizSummaryFromRun = (run: QuizRunSnapshot): QuizSummary => ({
  runId: run.id,
  status: run.status,
  totalQuestions: run.totalQuestions,
  correctCount: run.correctCount,
  wrongCount: run.wrongCount,
  skippedCount: run.skippedCount,
  accuracyPercent: quizAccuracy(run.correctCount, run.totalQuestions),
  durationSeconds: run.durationSeconds,
});

const finalizeCompletedRun = async (run: QuizRunSnapshot): Promise<QuizSummary> => {
  if (run.status !== 'ACTIVE') return toQuizSummaryFromRun(run);
  const now = new Date();
  const durationSeconds = Math.max(0, Math.round((now.getTime() - run.startedAt.getTime()) / 1000));
  const updated = await prisma.quizRun.update({
    where: { id: run.id },
    data: {
      status: 'COMPLETED',
      finishedAt: now,
      durationSeconds,
      lastActivityAt: now,
    },
    select: {
      id: true,
      status: true,
      totalQuestions: true,
      currentIndex: true,
      correctCount: true,
      wrongCount: true,
      skippedCount: true,
      startedAt: true,
      durationSeconds: true,
    },
  });
  return toQuizSummaryFromRun(updated);
};

const mainReplyKeyboard = (lang: Lang) =>
  Markup.keyboard([[NEWS_DIGEST_BUTTON_BY_LANG[lang], QUIZ_BUTTON_BY_LANG[lang]]]).resize().persistent(true);
const openWebAppKeyboard = (lang: Lang) =>
  webAppUrl
    ? Markup.inlineKeyboard([[Markup.button.webApp(webAppLabel(lang), webAppUrl)]])
    : undefined;

const toTelegramProfile = (from?: Context['from']): TelegramProfile | undefined => {
  if (!from) return undefined;
  return {
    username: from.username ?? null,
    firstName: from.first_name ?? null,
    lastName: from.last_name ?? null,
  };
};



const flagForDetectedLang = (detected: 'ru' | 'uz' | 'en', ambiguous = false) => {
  if (ambiguous) return '\u{1F310}';
  if (detected === 'ru') return '\u{1F1F7}\u{1F1FA}';
  if (detected === 'uz') return '\u{1F1FA}\u{1F1FF}';
  return '\u{1F1FA}\u{1F1F8}';
};

const formatPairLine = (
  leftText: string,
  rightText: string,
  uiLang: Lang,
  leftLang?: 'ru' | 'uz' | 'en',
  rightLang?: 'ru' | 'uz' | 'en'
) => {
  const preferredNative = uiLang === 'uz' ? 'uz' : 'ru';
  const leftDetected = leftLang
    ? { lang: leftLang, ambiguous: false }
    : detectLanguageWithMeta(leftText, { preferredNative });
  const rightDetected = rightLang
    ? { lang: rightLang, ambiguous: false }
    : detectLanguageWithMeta(rightText, { preferredNative });

  return `${flagForDetectedLang(leftDetected.lang, leftDetected.ambiguous)} <b>${escapeHtml(leftText)}</b> — ${flagForDetectedLang(rightDetected.lang, rightDetected.ambiguous)} ${escapeHtml(rightText)}`;
};

const nativeLangForUi = (lang: Lang): 'ru' | 'uz' => (lang === 'uz' ? 'uz' : 'ru');

const hasCyrillic = (value: string) => /[\u0400-\u04FF]/u.test(value);

const hasUzSpecificLatinMarkers = (value: string) =>
  /[\u02BB\u02BC]/u.test(value) ||
  /(o['\u02BB\u02BC\u2019`]|g['\u02BB\u02BC\u2019`])/iu.test(value);

const shouldTryGeminiDisambiguation = (input: string, detectedLang: 'ru' | 'uz' | 'en') => {
  const normalized = input.trim();
  if (!normalized || hasCyrillic(normalized)) return false;
  if (detectedLang === 'en') return true;
  if (detectedLang !== 'uz') return false;

  // Ambiguous short latin inputs like "ham" are common false positives for local UZ heuristic.
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length > 2) return false;
  if (normalized.length > 10) return false;
  if (hasUzSpecificLatinMarkers(normalized)) return false;
  return true;
};

const MAX_HINT_PRESSES_PER_CARD = 3;

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

const buildHintMaskByPress = (value: string, press: number): string | null => {
  const chars = Array.from(value.trim());
  if (!chars.length) return null;
  const reveal = [0];
  if (press >= 2 && chars.length > 1) reveal.push(chars.length - 1);
  if (press >= 3 && chars.length > 2) reveal.push(1);
  return buildMaskedHint(value.trim(), reveal);
};

const cardInlineKeyboard = (reviewId: number, swapData?: string | null) => {
  const row: Array<{ text: string; callback_data: string }> = [{ text: '💡', callback_data: `hint:${reviewId}` }];
  if (swapData) row.push({ text: '🔄', callback_data: swapData });
  return { inline_keyboard: [row] };
};



const languageKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('🇷🇺 Русский', 'lang:ru'), Markup.button.callback('🇺🇿 O‘zbekcha', 'lang:uz')],
]);

type SettingsView = 'main' | 'interval' | 'limit';

const settingsMainKeyboard = (user: any, lang: Lang) =>
  Markup.inlineKeyboard([
    [Markup.button.callback(user.notificationsEnabled ? t(lang, 'btn.notifyOn') : t(lang, 'btn.notifyOff'), 'notify:toggle')],
    [Markup.button.callback(t(lang, 'btn.interval'), 'settings:interval'), Markup.button.callback(t(lang, 'btn.limit'), 'settings:limit')],
  ]);

const renderMainText = (user: any, lang: Lang) => {
  return [
    t(lang, 'settings.title'),
    '',
    user.notificationsEnabled ? t(lang, 'settings.notificationsOn') : t(lang, 'settings.notificationsOff'),
    t(lang, 'settings.intervalLine', { value: user.notificationIntervalMinutes }),
    t(lang, 'settings.limitLine', { value: user.maxNotificationsPerDay }),
  ].join('\n');
};

const renderSectionText = (view: SettingsView, user: any, lang: Lang) => {
  switch (view) {
    case "interval":
      return t(lang, "settings.interval.ask", {
        current: user.notificationIntervalMinutes,
        min: MIN_NOTIFICATION_INTERVAL,
        max: MAX_NOTIFICATION_INTERVAL,
      });
    case "limit":
      return t(lang, "settings.limit.ask", {
        current: user.maxNotificationsPerDay,
        min: MIN_NOTIFICATIONS_PER_DAY,
        max: MAX_NOTIFICATIONS_PER_DAY,
      });
    default:
      return renderMainText(user, lang);
  }
};

const safeReply = async (ctx: Context, text: string, extra?: any) => {
  try {
    await ctx.reply(text, { parse_mode: 'HTML', ...extra });
  } catch (e) {
    console.error('Reply error:', e);
  }
};

const safeEditOrReply = async (ctx: Context, text: string, extra?: any) => {
  if ('editMessageText' in ctx) {
    try {
      await (ctx as any).editMessageText(text, { parse_mode: 'HTML', ...extra });
      return;
    } catch {
      // fallback to reply below
    }
  }
  await safeReply(ctx, text, extra);
};

const sendSettings = async (ctx: Context, userId: number, view: SettingsView = "main", edit = false) => {
  const fresh = await ensureUser(userId, toTelegramProfile(ctx.from));
  const lang = (fresh.language as Lang) || 'ru';
  const text = renderSectionText(view, fresh, lang);
  const keyboard =
    view === "interval" || view === "limit"
      ? Markup.inlineKeyboard([[Markup.button.callback(t(lang, "btn.back"), "settings:main")]])
      : settingsMainKeyboard(fresh, lang);

  if (edit && "editMessageText" in ctx) {
    try {
      await (ctx as any).editMessageText(text, { parse_mode: "HTML", ...keyboard });
      return;
    } catch (e) {
      // fall back
    }
  }
  await ctx.reply(text, { parse_mode: "HTML", ...keyboard });
};
bot.start(async (ctx) => {
  if (!ctx.from) return;
  const user = await ensureUser(ctx.from.id, toTelegramProfile(ctx.from));
  const rawPayload = (ctx as any).startPayload ?? ctx.message?.text?.split(' ').slice(1).join(' ') ?? '';
  const match = typeof rawPayload === 'string' ? rawPayload.match(/^ref_(\d+)$/i) : null;
  if (match) {
    const referrerId = Number(match[1]);
    if (Number.isFinite(referrerId) && referrerId > 0) {
      await setReferredByIfEmpty(Number(user.id), referrerId);
    }
  }
  await ensureSession(user.id);
  await setState(user.id, 'IDLE', { payload: { onboarding: { step: 'lang' } } });
  const chooseLangText = `${t('ru', 'chooseLang')}\n${t('uz', 'chooseLang')}`;
  await ctx.reply(chooseLangText, { parse_mode: 'HTML', ...languageKeyboard });
});

bot.command('app', async (ctx) => {
  if (!ctx.from) return;
  const user = await ensureUser(ctx.from.id, toTelegramProfile(ctx.from));
  const lang = (user.language as Lang) || 'ru';
  if (!webAppUrl) {
    await ctx.reply(webAppUnavailableText, { parse_mode: 'HTML' });
    return;
  }
  await ctx.reply(lang === 'uz' ? 'Ilovani oching' : 'Открой приложение', {
    parse_mode: 'HTML',
    ...openWebAppKeyboard(lang),
  });
});

bot.command('add', async (ctx) => {
  if (!ctx.from) return;
  const userId = ctx.from.id;
  const user = await ensureUser(userId, toTelegramProfile(ctx.from));
  await setState(BigInt(userId), 'ADDING_WORD_WAIT_EN');
  await ctx.reply(t(user.language as Lang, 'add.enter'), { parse_mode: 'HTML' });
});

bot.command('settings', async (ctx) => {
  if (!ctx.from) return;
  const user = await ensureUser(ctx.from.id, toTelegramProfile(ctx.from));
  const lang = (user.language as Lang) || 'ru';
  if (!webAppUrl) {
    await ctx.reply(webAppUnavailableText, { parse_mode: 'HTML' });
    return;
  }
  await ctx.reply(lang === 'uz' ? 'Sozlamalar ilovada' : 'Настройки в приложении', {
    parse_mode: 'HTML',
    ...openWebAppKeyboard(lang),
  });
});

bot.command('stats', async (ctx) => {
  if (!ctx.from) return;
  const user = await ensureUser(ctx.from.id, toTelegramProfile(ctx.from));
  const lang = (user.language as Lang) || 'ru';
  if (!webAppUrl) {
    await ctx.reply(webAppUnavailableText, { parse_mode: 'HTML' });
    return;
  }
  await ctx.reply(lang === 'uz' ? 'Statistika ilovada' : 'Статистика в приложении', {
    parse_mode: 'HTML',
    ...openWebAppKeyboard(lang),
  });
});


bot.hears(QUIZ_BUTTONS, async (ctx) => {
  if (!ctx.from) return;

  const user = await ensureUser(ctx.from.id, toTelegramProfile(ctx.from));
  const lang = ((user.language as Lang) || 'ru');
  try {
    const session = await getSession(BigInt(user.id));

    if (session.state === 'WAITING_ANSWER' || session.state === 'WAITING_GRADE') {
      await ctx.reply(quizBusyStateText(lang), { parse_mode: 'HTML', ...mainReplyKeyboard(lang) });
      return;
    }

    const result = await startOrResumeQuiz(user.id);
    if (!result.ok) {
      if (result.reason === 'LIMIT_REACHED') {
        await ctx.reply(quizLimitReachedText(lang, result.usedToday), { parse_mode: 'HTML', ...mainReplyKeyboard(lang) });
        return;
      }
      await ctx.reply(quizInsufficientWordsText(lang, result.minRequiredWords ?? 4), {
        parse_mode: 'HTML',
        ...mainReplyKeyboard(lang),
      });
      return;
    }

    if (!result.question && result.summary) {
      await resetState(BigInt(user.id));
      await ctx.reply(quizSummaryText(lang, result.summary), { parse_mode: 'HTML', ...mainReplyKeyboard(lang) });
      return;
    }

    if (!result.question) {
      await resetState(BigInt(user.id));
      await ctx.reply(lang === 'uz' ? 'Quizni boshlab bolmadi. Qayta urinib koring.' : 'Не удалось запустить Quiz. Попробуйте снова.', {
        parse_mode: 'HTML',
        ...mainReplyKeyboard(lang),
      });
      return;
    }

    await setState(BigInt(user.id), 'QUIZ_ACTIVE', {
      payload: {
        lang,
        quizRunId: result.runId,
      },
    });

    await ctx.reply(quizQuestionText(lang, result.question), {
      parse_mode: 'HTML',
      ...quizQuestionKeyboard(lang, result.question),
    });
  } catch (error) {
    console.error('[quiz] start failed', { userId: user.id, error });
    if (isQuizSchemaMissingError(error)) {
      await ctx.reply(quizUnavailableText(lang), { ...mainReplyKeyboard(lang) });
      return;
    }
    await ctx.reply(lang === 'uz' ? 'Quiz xatosi. Qayta urinib koring.' : 'Ошибка Quiz. Попробуйте снова.', {
      ...mainReplyKeyboard(lang),
    });
  }
});

bot.hears(NEWS_DIGEST_BUTTONS, async (ctx) => {
  if (!ctx.from) return;

  const user = await ensureUser(ctx.from.id, toTelegramProfile(ctx.from));
  const lang = ((user.language as Lang) || 'ru');
  try {
    const digest = await buildUserNewsDigest(user.id);

    if (!digest.length) {
      await ctx.reply(NEWS_DIGEST_FALLBACK_TEXT_BY_LANG[lang], {
        parse_mode: 'HTML',
        ...mainReplyKeyboard(lang),
      });
      return;
    }

    const session = await ensureSession(BigInt(user.id));
    const payloadBase = (session.payload && typeof session.payload === 'object' && !Array.isArray(session.payload))
      ? (session.payload as Record<string, unknown>)
      : {};
    const digestItems: NewsDigestNavItem[] = digest.map((item) => ({
      wordId: item.wordId,
      wordEn: item.wordEn,
      translation: item.translation,
      highlightedText: item.highlightedText,
      sourceUrl: item.sourceUrl,
      sourceTitle: item.sourceTitle,
    }));
    await prisma.userSession.update({
      where: { userId: BigInt(user.id) },
      data: {
        payload: {
          ...payloadBase,
          newsDigest: {
            items: digestItems,
            index: 0,
            updatedAt: new Date().toISOString(),
          },
        } as Prisma.InputJsonValue,
      },
    });

    const text = renderNewsDigestCard(lang, digestItems[0]!);

    await ctx.reply(text, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...newsDigestInlineKeyboard(lang, 0, digestItems.length),
    });
  } catch (error) {
    console.error('[bot] news digest failed', { userId: user.id, error });
    await ctx.reply(NEWS_DIGEST_FALLBACK_TEXT_BY_LANG[lang], {
      parse_mode: 'HTML',
      ...mainReplyKeyboard(lang),
    });
  }
});

bot.on('text', async (ctx) => {
  if (!ctx.from || !ctx.message?.text) return;
  const userId = ctx.from.id;
  const user = await ensureUser(userId, toTelegramProfile(ctx.from));
  const lang = (user.language as Lang) || 'ru';
  const session = await getSession(BigInt(userId));
  const text = normalizeWhitespace(ctx.message.text);

  const findExistingWord = async (wordEn: string) => {
    return prisma.word.findFirst({
      where: {
        userId: BigInt(userId),
        wordEn: { equals: wordEn.trim(), mode: 'insensitive' },
      },
    });
  };

  const handleAddFlow = async (input: string) => {
    const normalizedInput = input.trim();
    if (!normalizedInput) return;
    const searchingMsg = await ctx.reply(t(lang, 'add.searchingTranslation'), { parse_mode: 'HTML' });

    const inputDetection = detectLanguageWithMeta(normalizedInput, {
      preferredNative: lang === 'uz' ? 'uz' : 'ru',
    });
    const inputLang = inputDetection.lang;
    let resolvedInputLang = inputLang;
    let resolvedInputAmbiguous = inputDetection.ambiguous;
    const targetLang: 'ru' | 'uz' = nativeLangForUi(lang);

    let finalEn = normalizedInput;
    let finalTranslation: string | null = null;
    let usedMyMemoryDueToLimit = false;
    let exhaustedAutoTranslateLimit: number | null = null;
    let shouldCommitAutoTranslateQuota = false;
    const tryGeminiSmart = async () => {
      const geminiSmart = await detectAndTranslateWithGemini(normalizedInput, targetLang);
      if (!geminiSmart?.translatedText) return false;
      if (geminiSmart.confidence < 0.55) return false;

      if (geminiSmart.sourceLang === 'en') {
        resolvedInputLang = 'en';
        resolvedInputAmbiguous = false;
        finalEn = normalizedInput;
        finalTranslation = geminiSmart.translatedText;
        return true;
      }

      if (geminiSmart.sourceLang === 'ru' || geminiSmart.sourceLang === 'uz') {
        resolvedInputLang = geminiSmart.sourceLang;
        resolvedInputAmbiguous = false;
        finalEn = geminiSmart.translatedText;
        finalTranslation = normalizedInput;
        return true;
      }

      return false;
    };

    if (resolvedInputLang === 'ru' || resolvedInputLang === 'uz') {
      const quota = await checkAutoTranslateQuota(BigInt(userId), user.timezone);
      if (!quota.allowed) {
        usedMyMemoryDueToLimit = true;
        exhaustedAutoTranslateLimit = quota.limit;
        const englishTranslation = await translateAutoWithMyMemory(normalizedInput, 'en');
        if (!englishTranslation) {
          await setState(BigInt(userId), 'ADDING_WORD_WAIT_EN');
          await ctx.deleteMessage(searchingMsg.message_id).catch(() => { });
          await ctx.reply(t(lang, 'add.apiLimitNeedEnglish', { limit: quota.limit }), { parse_mode: 'HTML' });
          return;
        }
        finalEn = englishTranslation;
        finalTranslation = normalizedInput;
      }
      if (quota.allowed) shouldCommitAutoTranslateQuota = true;

      // User typed in RU/UZ - translate to English and swap.
      if (quota.allowed && shouldTryGeminiDisambiguation(normalizedInput, resolvedInputLang)) {
        await tryGeminiSmart();
      }

      if (!finalTranslation) {
        const englishTranslation = await translateAuto(normalizedInput, 'en');
        if (!englishTranslation) {
          await setState(BigInt(userId), 'ADDING_WORD_WAIT_EN');
          await ctx.deleteMessage(searchingMsg.message_id).catch(() => { });
          await ctx.reply(t(lang, 'add.needEnglishWord'), { parse_mode: 'HTML' });
          return;
        }
        finalEn = englishTranslation;
        finalTranslation = normalizedInput;
      }
    } else {
      const existing = await findExistingWord(finalEn);
      if (existing) {
        const pair = formatPairLine(existing.wordEn, existing.translationRu, lang, 'en', targetLang);
        await ctx.deleteMessage(searchingMsg.message_id).catch(() => { });
        await ctx.reply(t(lang, 'add.exists', { pair }), { parse_mode: 'HTML' });
        await resetState(BigInt(userId));
        return;
      }

      const quota = await checkAutoTranslateQuota(BigInt(userId), user.timezone);
      if (!quota.allowed) {
        usedMyMemoryDueToLimit = true;
        exhaustedAutoTranslateLimit = quota.limit;
        finalTranslation = await translateAutoWithMyMemory(finalEn, targetLang);
        if (!finalTranslation) {
          await setState(BigInt(userId), 'ADDING_WORD_WAIT_RU_MANUAL', {
            payload: { wordEn: finalEn },
          });
          await ctx.deleteMessage(searchingMsg.message_id).catch(() => { });
          await ctx.reply(t(lang, 'add.apiLimitManualTranslation', { limit: quota.limit }), { parse_mode: 'HTML' });
          return;
        }
      }
      if (quota.allowed) shouldCommitAutoTranslateQuota = true;

      // User typed in English - translate to user's native language.
      if (quota.allowed) {
        await tryGeminiSmart();
      }

      if (!finalTranslation) {
        finalTranslation = quota.allowed
          ? await suggestTranslation(finalEn, targetLang)
          : await translateAutoWithMyMemory(finalEn, targetLang);
      }
    }

    // Check for duplicate
    const existing = await findExistingWord(finalEn);
    if (existing) {
      const pair = formatPairLine(existing.wordEn, existing.translationRu, lang, 'en', targetLang);
      await ctx.deleteMessage(searchingMsg.message_id).catch(() => { });
      await ctx.reply(t(lang, 'add.exists', { pair }), { parse_mode: 'HTML' });
      await resetState(BigInt(userId));
      return;
    }

    if (finalTranslation) {
      if (usedMyMemoryDueToLimit && exhaustedAutoTranslateLimit) {
        await ctx.reply(t(lang, 'add.apiLimitFallbackQuality', { limit: exhaustedAutoTranslateLimit }), {
          parse_mode: 'HTML',
        });
      }

      const sourceForQuality =
        resolvedInputLang === 'ru' || resolvedInputLang === 'uz'
          ? normalizedInput
          : finalEn;
      const translatedForQuality =
        resolvedInputLang === 'ru' || resolvedInputLang === 'uz'
          ? finalEn
          : finalTranslation;
      if (isSuspiciousAutoTranslation(sourceForQuality, translatedForQuality)) {
        if (resolvedInputLang === 'ru' || resolvedInputLang === 'uz') {
          await setState(BigInt(userId), 'ADDING_WORD_WAIT_RU_MANUAL', {
            payload: { sourceNative: normalizedInput, manualField: 'en' },
          });
          await ctx.deleteMessage(searchingMsg.message_id).catch(() => { });
          await ctx.reply(t(lang, 'add.needEnglishWord'), { parse_mode: 'HTML' });
          return;
        }

        await setState(BigInt(userId), 'ADDING_WORD_WAIT_RU_MANUAL', {
          payload: { wordEn: finalEn },
        });
        await ctx.deleteMessage(searchingMsg.message_id).catch(() => { });
        await ctx.reply(t(lang, 'add.suspectAutoTranslation'), { parse_mode: 'HTML' });
        return;
      }

      const pair =
        resolvedInputLang === 'ru' || resolvedInputLang === 'uz'
          ? formatPairLine(finalTranslation, finalEn, lang, resolvedInputAmbiguous ? undefined : resolvedInputLang, 'en')
          : formatPairLine(finalEn, finalTranslation, lang, resolvedInputAmbiguous ? undefined : 'en', targetLang);
      if (shouldCommitAutoTranslateQuota) {
        const committed = await commitAutoTranslateQuota(BigInt(userId), user.timezone);
        if (!committed.allowed) {
          console.warn('Auto-translate quota commit skipped due to concurrent limit usage', {
            userId,
            limit: committed.limit,
            used: committed.used,
          });
        }
      }
      await setState(BigInt(userId), 'ADDING_WORD_CONFIRM_TRANSLATION', {
        payload: { wordEn: finalEn, translationRu: finalTranslation },
      });
      await ctx.deleteMessage(searchingMsg.message_id).catch(() => { });
      await ctx.reply(t(lang, 'add.suggest', { pair }), { parse_mode: 'HTML', ...confirmKeyboard(lang) });
    } else {
      await setState(BigInt(userId), 'ADDING_WORD_WAIT_RU_MANUAL', {
        payload: { wordEn: finalEn },
      });
      await ctx.deleteMessage(searchingMsg.message_id).catch(() => { });
      await ctx.reply(t(lang, 'add.noSuggest', { en: finalEn }), { parse_mode: 'HTML' });
    }
  };

  switch (session.state) {
    case 'SETTINGS_WAIT_INTERVAL': {
      // Use language provided in onboarding if available, otherwise user preference
      const onboardingLang = (session.payload as any)?.onboarding?.lang as Lang | undefined;
      const effectiveLang: Lang = onboardingLang ?? lang;
      const inOnboarding = !!(session.payload as any)?.onboarding;
      const value = parseInt(text, 10);
      if (!Number.isFinite(value)) {
        const msg = inOnboarding ? t(effectiveLang, 'intervalNeedNumber') : t(effectiveLang, 'settings.interval.needNumber');
        await ctx.reply(msg, { parse_mode: 'HTML' });
        return;
      }
      if (value < MIN_NOTIFICATION_INTERVAL || value > MAX_NOTIFICATION_INTERVAL) {
        const msg = inOnboarding
          ? t(effectiveLang, 'intervalOutOfRange', { min: MIN_NOTIFICATION_INTERVAL, max: MAX_NOTIFICATION_INTERVAL })
          : t(effectiveLang, 'settings.interval.outRange', { min: MIN_NOTIFICATION_INTERVAL, max: MAX_NOTIFICATION_INTERVAL });
        await ctx.reply(msg, inOnboarding ? { parse_mode: 'HTML' } : { parse_mode: 'HTML' });
        return;
      }
      await setNotificationInterval(userId, value);
      await resetState(BigInt(userId));
      if (inOnboarding) {
        // Final step of onboarding: Show success and reveal keyboard
        await ctx.reply(t(effectiveLang, 'onboarding.finished', { value }), {
          parse_mode: 'HTML',
          ...mainReplyKeyboard(effectiveLang),
        });
        if (webAppUrl) {
          await ctx.reply(
            effectiveLang === 'uz' ? 'Sozlamalar va statistika ilovada' : 'Настройки и статистика в приложении',
            { parse_mode: 'HTML', ...openWebAppKeyboard(effectiveLang) }
          );
        }
        // Do NOT send settings menu here
      } else {
        await ctx.reply(t(effectiveLang, 'settings.interval.saved', { value }), { parse_mode: 'HTML' });
        await sendSettings(ctx, userId, 'main', true);
      }
      break;
    }
    case 'SETTINGS_WAIT_GOAL': {
      const onboardingLang = (session.payload as any)?.onboarding?.lang as Lang | undefined;
      const effectiveLang: Lang = onboardingLang ?? lang;
      const inOnboarding = !!(session.payload as any)?.onboarding;
      const value = parseInt(text, 10);
      if (!Number.isFinite(value)) {
        const msg = inOnboarding ? t(effectiveLang, 'goalNeedNumber') : t(effectiveLang, 'settings.limit.needNumber');
        await ctx.reply(msg, { parse_mode: 'HTML' });
        return;
      }
      if (value < MIN_NOTIFICATIONS_PER_DAY || value > MAX_NOTIFICATIONS_PER_DAY) {
        const msg = inOnboarding
          ? t(effectiveLang, 'goalOutOfRange', { min: MIN_NOTIFICATIONS_PER_DAY, max: MAX_NOTIFICATIONS_PER_DAY })
          : t(effectiveLang, 'settings.limit.outRange', { min: MIN_NOTIFICATIONS_PER_DAY, max: MAX_NOTIFICATIONS_PER_DAY });
        await ctx.reply(
          msg,
          { parse_mode: 'HTML' }
        );
        return;
      }
      await setNotificationLimit(userId, value);
      if (inOnboarding) {
        await setState(BigInt(userId), 'SETTINGS_WAIT_INTERVAL', {
          payload: { onboarding: { lang: effectiveLang } },
        });
        await ctx.reply(
          t(effectiveLang, 'askInterval', {
            current: user.notificationIntervalMinutes,
            min: MIN_NOTIFICATION_INTERVAL,
            max: MAX_NOTIFICATION_INTERVAL,
          }),
          { parse_mode: 'HTML' }
        );
      } else {
        await resetState(BigInt(userId));
        await ctx.reply(t(effectiveLang, 'settings.limit.saved', { value }), { parse_mode: 'HTML' });
        await sendSettings(ctx, userId, 'main', true);
      }
      break;
    }
    case 'ADDING_WORD_WAIT_EN': {
      await handleAddFlow(text);
      break;
    }
    case 'ADDING_WORD_WAIT_RU_MANUAL': {
      const payload = (session.payload as any) || {};
      if (payload.manualField === 'en') {
        const manualWordEn = text.trim();
        const sourceNative = typeof payload.sourceNative === 'string' ? payload.sourceNative.trim() : '';
        if (!manualWordEn || !sourceNative) {
          await resetState(BigInt(userId));
          await ctx.reply(t(lang, 'add.failSave'), { parse_mode: 'HTML' });
          return;
        }
        const existing = await findExistingWord(manualWordEn);
        if (existing) {
          const pair = formatPairLine(existing.wordEn, existing.translationRu, lang, 'en', nativeLangForUi(lang));
          await ctx.reply(t(lang, 'add.exists', { pair }), { parse_mode: 'HTML' });
          await resetState(BigInt(userId));
          return;
        }
        try {
          const result = await addWordForUser(BigInt(userId), manualWordEn, sourceNative);
          const addLang = (lang === 'uz' ? 'uz' : 'ru') as 'ru' | 'uz';
          generateSentences(manualWordEn, sourceNative, addLang)
            .then((s) => s && saveSentences(result.wordId, s))
            .catch(() => {/* cron will retry */ });
          await resetState(BigInt(userId));
          const pair = formatPairLine(manualWordEn, sourceNative, lang, 'en', nativeLangForUi(lang));
          await ctx.reply(
            t(lang, 'add.saved', { pair }),
            { parse_mode: 'HTML' }
          );
        } catch (error) {
          if (error instanceof DailyWordLimitError) {
            await ctx.reply(t(lang, 'add.dailyLimit', { limit: error.limit }), { parse_mode: 'HTML' });
          } else if (error instanceof DuplicateWordError) {
            await ctx.reply(t(lang, 'add.duplicate', { en: manualWordEn }), { parse_mode: 'HTML' });
          } else {
            await ctx.reply(error instanceof Error ? error.message : t(lang, 'add.error'), { parse_mode: 'HTML' });
          }
          await resetState(BigInt(userId));
        }
        return;
      }

      if (!payload.wordEn) {
        await resetState(BigInt(userId));
        await ctx.reply(t(lang, 'add.failSave'), { parse_mode: 'HTML' });
        return;
      }
      try {
        const result = await addWordForUser(BigInt(userId), payload.wordEn, text);
        // Fire-and-forget sentence generation
        const addLang = (lang === 'uz' ? 'uz' : 'ru') as 'ru' | 'uz';
        generateSentences(payload.wordEn, text, addLang)
          .then((s) => s && saveSentences(result.wordId, s))
          .catch(() => {/* cron will retry */ });
        await resetState(BigInt(userId));
        const pair = formatPairLine(payload.wordEn, text, lang, 'en', nativeLangForUi(lang));
        await ctx.reply(
          t(lang, 'add.saved', { pair }),
          { parse_mode: 'HTML' }
        );
      } catch (error) {
        if (error instanceof DailyWordLimitError) {
          await ctx.reply(t(lang, 'add.dailyLimit', { limit: error.limit }), { parse_mode: 'HTML' });
        } else
          if (error instanceof DuplicateWordError) {
            await ctx.reply(t(lang, 'add.duplicate', { en: payload.wordEn }), { parse_mode: 'HTML' });
          } else {
            await ctx.reply(error instanceof Error ? error.message : t(lang, 'add.error'), { parse_mode: 'HTML' });
          }
        await resetState(BigInt(userId));
      }
      break;
    }
    case 'WAITING_ANSWER': {
      if (!session.reviewId || !session.direction) {
        await resetState(BigInt(userId));
        await ctx.reply(t(lang, 'session.lost'), { parse_mode: 'HTML' });
        return;
      }
      const review = await loadReviewWithWord(session.reviewId);
      if (!review || !review.word) {
        await resetState(BigInt(userId));
        await ctx.reply(t(lang, 'session.lost'), { parse_mode: 'HTML' });
        return;
      }
      if (review.lastResult === 'SKIPPED' && review.lastReviewAt && session.sentAt) {
        const skippedAt = review.lastReviewAt.getTime();
        const sentAt = session.sentAt.getTime();
        if (skippedAt >= sentAt) {
          await resetState(BigInt(userId));
          await ctx.reply(t(lang, 'worker.skipped'), { parse_mode: 'HTML' });
          return;
        }
      }
      const direction = session.direction;
      const { correct } = checkAnswer(direction, review.word.wordEn, review.word.translationRu, text);
      const correctAnswer = direction === 'RU_TO_EN' ? review.word.wordEn : review.word.translationRu;
      await setState(BigInt(userId), 'WAITING_GRADE', {
        reviewId: session.reviewId,
        wordId: review.wordId,
        direction,
        sentAt: session.sentAt ?? new Date(),
        answerText: text,
        payload: { correct },
      });

      const resultText = correct ? t(lang, 'answer.correct') : t(lang, 'answer.incorrect');
      const correctText = t(lang, 'answer.correctIs', { answer: correctAnswer });

      await ctx.reply(
        `${resultText}\n${correctText}\n${t(lang, 'answer.pickGrade')}`,
        { parse_mode: 'HTML', ...gradeKeyboard }
      );
      break;
    }
    case 'WAITING_GRADE': {
      await ctx.reply(t(lang, 'answer.pickGrade'), { parse_mode: 'HTML' });
      break;
    }
    case 'QUIZ_ACTIVE': {
      await ctx.reply(quizUseButtonsText(lang), { parse_mode: 'HTML' });
      break;
    }
    case 'ADDING_WORD_CONFIRM_TRANSLATION': {
      await ctx.reply(t(lang, 'add.confirmPrompt'), { parse_mode: 'HTML' });
      break;
    }
    default:
      if (text.startsWith('/')) return; // ignore other commands
      await handleAddFlow(text);
      break;
  }
});

bot.on('callback_query', async (ctx) => {
  if (!ctx.from) return;
  const userId = ctx.from.id;
  const data = (ctx.callbackQuery as any)?.data || '';
  const session = await getSession(BigInt(userId));

  if (data.startsWith('lang:')) {
    const lang = data.split(':')[1] === 'uz' ? 'uz' : 'ru';
    await setLanguage(userId, lang); // PERSIST LANGUAGE
    const user = await ensureUser(userId, toTelegramProfile(ctx.from));
    await ctx.answerCbQuery();
    await ctx.reply(t(lang as Lang, 'hint'), {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback(t(lang as Lang, 'btn.next'), 'onboarding:next')]]),
    });
    return;
  }

  if (data === 'onboarding:next') {
    const user = await ensureUser(userId, toTelegramProfile(ctx.from));
    const lang = (user.language as Lang) || 'ru';
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); // remove button
    await setState(BigInt(userId), 'SETTINGS_WAIT_GOAL', { payload: { onboarding: { lang } } });
    await ctx.reply(
      t(lang, 'askGoal', {
        current: user.maxNotificationsPerDay,
        min: MIN_NOTIFICATIONS_PER_DAY,
        max: MAX_NOTIFICATIONS_PER_DAY,
      }),
      { parse_mode: 'HTML' }
    );
    return;
  }

  if (data.startsWith('quiz:')) {
    const user = await ensureUser(userId, toTelegramProfile(ctx.from));
    const lang = (user.language as Lang) || 'ru';
    const parts = data.split(':');
    const action = parts[1] ?? '';

    try {
      if (action === 'answer' || action === 'skip') {
        const runId = parsePositiveInt(parts[2]);
        const questionId = parsePositiveInt(parts[3]);
        const selectedOptionIndex = action === 'answer' ? parseNonNegativeInt(parts[4]) : null;

        if (!runId || !questionId || (action === 'answer' && selectedOptionIndex === null)) {
          await ctx.answerCbQuery(lang === 'uz' ? 'Quiz callback notogri.' : 'Некорректный callback Quiz.');
          return;
        }

        const run = await loadQuizRunSnapshot(BigInt(userId), runId);
        if (!run) {
          await ctx.answerCbQuery(t(lang, 'session.lost'));
          return;
        }

        if (run.status !== 'ACTIVE') {
          await resetState(BigInt(userId));
          await safeEditOrReply(ctx, quizSummaryText(lang, toQuizSummaryFromRun(run)));
          await ctx.answerCbQuery();
          return;
        }

        const result = await submitAnswer(runId, questionId, selectedOptionIndex, null);
        if (!result.ok) {
          if (result.reason === 'RUN_NOT_ACTIVE') {
            const latest = await loadQuizRunSnapshot(BigInt(userId), runId);
            if (latest) {
              await resetState(BigInt(userId));
              await safeEditOrReply(ctx, quizSummaryText(lang, toQuizSummaryFromRun(latest)));
              await ctx.answerCbQuery();
              return;
            }
          }
          await ctx.answerCbQuery(lang === 'uz' ? 'Javob qabul qilinmadi.' : 'Ответ не принят.');
          return;
        }

        if (result.duplicate) {
          await ctx.answerCbQuery(quizAlreadyHandledText(lang, result.stale));
          return;
        }

        if (result.summary && result.summary.status !== 'ACTIVE') {
          await resetState(BigInt(userId));
          await safeEditOrReply(ctx, quizSummaryText(lang, result.summary));
          await ctx.answerCbQuery();
          return;
        }

        await setState(BigInt(userId), 'QUIZ_ACTIVE', {
          payload: { lang, quizRunId: runId },
        });
        await safeEditOrReply(
          ctx,
          quizAnswerResultText(lang, result),
          quizAfterAnswerKeyboard(lang, runId, Boolean(result.nextQuestion)),
        );
        await ctx.answerCbQuery();
        return;
      }

      if (action === 'next') {
        const runId = parsePositiveInt(parts[2]);
        if (!runId) {
          await ctx.answerCbQuery(lang === 'uz' ? 'Quiz callback notogri.' : 'Некорректный callback Quiz.');
          return;
        }

        const run = await loadQuizRunSnapshot(BigInt(userId), runId);
        if (!run) {
          await ctx.answerCbQuery(t(lang, 'session.lost'));
          return;
        }

        if (run.status !== 'ACTIVE') {
          await resetState(BigInt(userId));
          await safeEditOrReply(ctx, quizSummaryText(lang, toQuizSummaryFromRun(run)));
          await ctx.answerCbQuery();
          return;
        }

        if (run.currentIndex >= run.totalQuestions) {
          const summary = await finalizeCompletedRun(run);
          await resetState(BigInt(userId));
          await safeEditOrReply(ctx, quizSummaryText(lang, summary));
          await ctx.answerCbQuery();
          return;
        }

        const question = await getCurrentQuestion(runId);
        if (!question) {
          await ctx.answerCbQuery(lang === 'uz' ? 'Savol topilmadi. Quizni qayta oching.' : 'Вопрос не найден. Откройте Quiz снова.');
          return;
        }

        await setState(BigInt(userId), 'QUIZ_ACTIVE', {
          payload: { lang, quizRunId: runId },
        });
        await safeEditOrReply(ctx, quizQuestionText(lang, question), quizQuestionKeyboard(lang, question));
        await ctx.answerCbQuery();
        return;
      }

      if (action === 'exit') {
        const runId = parsePositiveInt(parts[2]);
        if (!runId) {
          await ctx.answerCbQuery(lang === 'uz' ? 'Quiz callback notogri.' : 'Некорректный callback Quiz.');
          return;
        }

        const run = await loadQuizRunSnapshot(BigInt(userId), runId);
        if (!run) {
          await ctx.answerCbQuery(t(lang, 'session.lost'));
          return;
        }

        const summary = await finishQuiz(runId);
        await resetState(BigInt(userId));
        await safeEditOrReply(ctx, quizSummaryText(lang, summary ?? toQuizSummaryFromRun(run)));
        await ctx.answerCbQuery(lang === 'uz' ? 'Quiz to‘xtatildi.' : 'Квиз остановлен.');
        return;
      }

      await ctx.answerCbQuery(lang === 'uz' ? 'Nomalum quiz action.' : 'Unknown quiz action.');
      return;
    } catch (error) {
      console.error('[quiz] callback failed', { userId, data, error });
      if (isQuizSchemaMissingError(error)) {
        await resetState(BigInt(userId));
        await ctx.answerCbQuery(lang === 'uz' ? 'Quiz vaqtincha mavjud emas.' : 'Quiz временно недоступен.');
        await ctx.reply(quizUnavailableText(lang), { ...mainReplyKeyboard(lang) });
        return;
      }
      await ctx.answerCbQuery(lang === 'uz' ? 'Quiz xatosi.' : 'Ошибка Quiz.');
      return;
    }
  }

  if (data === NEWS_NAV_PREV_CALLBACK || data === NEWS_NAV_NEXT_CALLBACK || data === NEWS_NAV_NOOP_CALLBACK) {
    const user = await ensureUser(userId, toTelegramProfile(ctx.from));
    const lang = (user.language as Lang) || 'ru';

    const payload = (session.payload && typeof session.payload === 'object' && !Array.isArray(session.payload))
      ? (session.payload as Record<string, unknown>)
      : null;
    const digestPayload = (payload?.newsDigest && typeof payload.newsDigest === 'object' && !Array.isArray(payload.newsDigest))
      ? (payload.newsDigest as Record<string, unknown>)
      : null;
    const rawItems = Array.isArray(digestPayload?.items) ? digestPayload.items : [];
    const items = rawItems.filter(isNewsDigestNavItem);

    if (!items.length) {
      await ctx.answerCbQuery(NEWS_DIGEST_STALE_TEXT_BY_LANG[lang]);
      return;
    }

    const currentIndex = (typeof digestPayload?.index === 'number' && Number.isFinite(digestPayload.index))
      ? Math.max(0, Math.min(items.length - 1, digestPayload.index))
      : 0;

    if (data === NEWS_NAV_NOOP_CALLBACK) {
      await ctx.answerCbQuery(`${currentIndex + 1}/${items.length}`);
      return;
    }

    const step = data === NEWS_NAV_NEXT_CALLBACK ? 1 : -1;
    const nextIndex = (currentIndex + step + items.length) % items.length;
    const payloadBase = payload ?? {};

    await prisma.userSession.update({
      where: { userId: BigInt(userId) },
      data: {
        payload: {
          ...payloadBase,
          newsDigest: {
            items,
            index: nextIndex,
            updatedAt: new Date().toISOString(),
          },
        } as Prisma.InputJsonValue,
      },
    });

    await ctx.editMessageText(renderNewsDigestCard(lang, items[nextIndex]!), {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...newsDigestInlineKeyboard(lang, nextIndex, items.length),
    });
    await ctx.answerCbQuery(`${nextIndex + 1}/${items.length}`);
    return;
  }

  if (data.startsWith('settings:')) {
    const view = data.split(':')[1] as SettingsView;
    const user = await ensureUser(userId, toTelegramProfile(ctx.from));
    const lang = (user.language as Lang) || 'ru';

    if (view === 'interval') {
      await resetState(BigInt(userId));
      await setState(BigInt(userId), 'SETTINGS_WAIT_INTERVAL');
      await ctx.answerCbQuery();
      await ctx.reply(renderSectionText('interval', user, lang), { parse_mode: 'HTML' });
      return;
    }
    if (view === 'limit') {
      await resetState(BigInt(userId));
      await setState(BigInt(userId), 'SETTINGS_WAIT_GOAL');
      await ctx.answerCbQuery();
      await ctx.reply(renderSectionText('limit', user, lang), { parse_mode: 'HTML' });
      return;
    }
    await resetState(BigInt(userId));
    await sendSettings(ctx, userId, 'main', true);
    await ctx.answerCbQuery();
    return;
  }

  if (data.startsWith('hint:')) {
    const reviewId = parseInt(data.split(':')[1] ?? '', 10);
    const user = await ensureUser(userId, toTelegramProfile(ctx.from));
    const lang = (user.language as Lang) || 'ru';

    if (!Number.isFinite(reviewId) || reviewId <= 0) {
      await ctx.answerCbQuery(t(lang, 'session.lost'));
      return;
    }

    if (session.state !== 'WAITING_ANSWER' || session.reviewId !== reviewId) {
      await ctx.answerCbQuery(t(lang, 'session.lost'));
      return;
    }

    const payload = (session.payload as any) || {};
    const currentPresses = Math.max(0, Number(payload.hintPresses ?? 0) || 0);
    if (currentPresses >= MAX_HINT_PRESSES_PER_CARD) {
      await ctx.answerCbQuery(t(lang, 'worker.hintLimit'));
      return;
    }

    let target = typeof payload.hintTarget === 'string' ? payload.hintTarget.trim() : '';
    if (!target) {
      const review = await loadReviewWithWord(reviewId);
      if (!review || !review.word) {
        await ctx.answerCbQuery(t(lang, 'session.lost'));
        return;
      }
      target = (session.direction === 'EN_TO_RU' ? review.word.translationRu : review.word.wordEn).trim();
    }

    const nextPress = currentPresses + 1;
    const masked = buildHintMaskByPress(target, nextPress);
    if (!masked) {
      await ctx.answerCbQuery(t(lang, 'session.lost'));
      return;
    }

    const baseText = typeof payload.cardBaseText === 'string' && payload.cardBaseText.trim().length > 0
      ? payload.cardBaseText
      : String((ctx.callbackQuery as any)?.message?.text ?? '');
    const hintInline = Boolean(payload.hintInline);
    const nextText = (hintInline && baseText.includes('___'))
      ? baseText.replace('___', escapeHtml(masked))
      : `${baseText}\n\n${t(lang, 'worker.hintReveal', { masked: escapeHtml(masked) })}`;
    const swapData = typeof payload.swapData === 'string' ? payload.swapData : null;

    const nextPayload = {
      ...payload,
      hintTarget: target,
      hintPresses: nextPress,
      cardBaseText: baseText,
    };
    await prisma.userSession.update({
      where: { userId: BigInt(userId) },
      data: { payload: nextPayload as Prisma.InputJsonValue },
    });

    await ctx.editMessageText(nextText, {
      parse_mode: 'HTML',
      reply_markup: cardInlineKeyboard(reviewId, swapData),
    });
    await ctx.answerCbQuery(`${nextPress}/${MAX_HINT_PRESSES_PER_CARD} 💡`);
    return;
  }

  if (data.startsWith('grade:')) {
    const user = await ensureUser(userId, toTelegramProfile(ctx.from));
    const lang = (user.language as Lang) || 'ru';
    if (session.state !== 'WAITING_GRADE' || !session.reviewId || !session.direction) {
      await ctx.answerCbQuery(t(lang, 'grade.noActive'));
      return;
    }
    const claim = await prisma.userSession.updateMany({
      where: {
        userId: BigInt(userId),
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
    if (claim.count === 0) {
      await ctx.answerCbQuery(t(lang, 'grade.noActive'));
      return;
    }
    const rating = data.split(':')[1] as Rating;
    const review = await loadReviewWithWord(session.reviewId);
    if (!review || !review.word) {
      await ctx.answerCbQuery(t(lang, 'session.lost'));
      return;
    }
    const wasCorrect = !!(session.payload as any)?.correct;
    const result: ReviewResult = wasCorrect ? 'CORRECT' : 'INCORRECT';
    await applyRating(review, rating, result, session.direction, session.answerText ?? undefined);

    const freshUser = await ensureUser(userId, toTelegramProfile(ctx.from));
    const progress = await recordCompletion(freshUser, wasCorrect);
    const limit = freshUser.maxNotificationsPerDay ?? DEFAULT_MAX_NOTIFICATIONS;
    let progressLine = '';
    if (Number.isFinite(limit) && limit > 0) {
      const done = progress.todayCompleted;
      const left = Math.max(0, limit - done);
      progressLine = left > 0
        ? t(lang, 'grade.progress', { done, limit, left })
        : t(lang, 'grade.limitReached');
    }

    const accepted = t(lang, 'grade.accepted');
    const message = progressLine ? `${accepted}\n${progressLine}` : accepted;
    await ctx.editMessageText(message, { parse_mode: 'HTML' });
    await ctx.answerCbQuery(t(lang, 'grade.saved'));
    return;
  }

  if (data === 'add_confirm') {
    const user = await ensureUser(userId, toTelegramProfile(ctx.from));
    const lang = (user.language as Lang) || 'ru';
    if (session.state !== 'ADDING_WORD_CONFIRM_TRANSLATION') {
      await ctx.answerCbQuery(t(lang, 'session.lost'));
      return;
    }
    const payload = (session.payload as any) || {};
    if (!payload.wordEn || !payload.translationRu) {
      await ctx.answerCbQuery(t(lang, 'session.lost'));
      return;
    }
    try {
      const result = await addWordForUser(BigInt(userId), payload.wordEn, payload.translationRu);
      // Fire-and-forget sentence generation
      const addLang = (lang === 'uz' ? 'uz' : 'ru') as 'ru' | 'uz';
      generateSentences(payload.wordEn, payload.translationRu, addLang)
        .then((s) => s && saveSentences(result.wordId, s))
        .catch(() => {/* cron will retry */ });
      await resetState(BigInt(userId));
      const pair = formatPairLine(payload.wordEn, payload.translationRu, lang, 'en', nativeLangForUi(lang));
      await ctx.editMessageText(
        t(lang, 'add.saved', { pair }),
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      if (error instanceof DailyWordLimitError) {
        await ctx.reply(t(lang, 'add.dailyLimit', { limit: error.limit }), { parse_mode: 'HTML' });
      } else
        if (error instanceof DuplicateWordError) {
          await ctx.reply(t(lang, 'add.duplicate', { en: payload.wordEn }), { parse_mode: 'HTML' });
        } else {
          await ctx.reply(error instanceof Error ? error.message : t(lang, 'add.error'), { parse_mode: 'HTML' });
        }
      await resetState(BigInt(userId));
    }
    await ctx.answerCbQuery();
    return;
  }

  if (data === 'add_change') {
    if (session.state !== 'ADDING_WORD_CONFIRM_TRANSLATION') {
      const user = await ensureUser(userId, toTelegramProfile(ctx.from));
      const lang = (user.language as Lang) || 'ru';
      await ctx.answerCbQuery(t(lang, 'session.lost'));
      return;
    }
    const payload = (session.payload as any) || {};
    await setState(BigInt(userId), 'ADDING_WORD_WAIT_RU_MANUAL', { payload: { wordEn: payload.wordEn } });
    await ctx.answerCbQuery();
    const user = await ensureUser(userId, toTelegramProfile(ctx.from));
    await ctx.editMessageText(t(user.language as Lang, 'add.manual'), { parse_mode: 'HTML' });
    return;
  }

  if (data === 'add_cancel') {
    const user = await ensureUser(userId, toTelegramProfile(ctx.from));
    const lang = (user.language as Lang) || 'ru';
    await resetState(BigInt(userId));
    await ctx.answerCbQuery();
    await ctx.editMessageText(t(lang, 'add.cancelled'), { parse_mode: 'HTML' });
    return;
  }

  if (data.startsWith('swap:')) {
    const [, wordIdStr, indexStr] = data.split(':');
    const wordId = parseInt(wordIdStr, 10);
    const index = parseInt(indexStr, 10);
    const user = await ensureUser(userId, toTelegramProfile(ctx.from));
    const lang = (user.language as Lang) || 'ru';

    if (session.state !== 'WAITING_ANSWER' || session.wordId !== wordId) {
      await ctx.answerCbQuery(t(lang, 'session.lost'));
      return;
    }

    // Rate limit: 1 swap per 24 hours per word. Also prune old entries.
    const lastSession = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    const payload = (lastSession?.payload as any) || {};
    const wordSwaps = payload.swaps || {};
    const nowMs = Date.now();
    for (const [key, val] of Object.entries(wordSwaps)) {
      if (nowMs - new Date(val as string).getTime() > 24 * 60 * 60 * 1000) {
        delete wordSwaps[key];
      }
    }
    const lastSwapStr = wordSwaps[wordId];
    if (lastSwapStr && nowMs - new Date(lastSwapStr).getTime() < 24 * 60 * 60 * 1000) {
      await ctx.answerCbQuery(lang === 'uz' ? 'Kunda bitta so\'zni faqat 1 marta almashtirish mumkin 🔄' : 'Менять пример можно 1 раз в день 🔄', { show_alert: true });
      return;
    }

    // Remove the bad sentence (but keep at least 2 examples in pool).
    const swapResult = await removeSentenceAtIndex(wordId, index);
    if (!swapResult.removed) {
      await ctx.answerCbQuery(
        lang === 'uz'
          ? 'Hozircha almashtirib bo\'lmaydi: kamida 2 ta misol qolishi kerak'
          : 'Сейчас заменить нельзя: должно остаться минимум 2 примера',
        { show_alert: true }
      );
      return;
    }

    // Record the swap after successful removal
    wordSwaps[wordId] = new Date().toISOString();
    payload.swaps = wordSwaps;

    // Load fresh word data with the next sentence
    const review = await loadReviewWithWord(session.reviewId!);
    if (!review || !review.word) {
      await ctx.answerCbQuery(t(lang, 'session.lost'));
      return;
    }

    const nextSentence = getSentenceForReview(review.word);
    if (!nextSentence) {
      // No sentences left - fallback, worker will handle
      payload.swapData = null;
      await prisma.userSession.update({
        where: { userId: BigInt(userId) },
        data: { payload: payload as Prisma.InputJsonValue },
      });
      await ctx.answerCbQuery(lang === 'uz' ? 'Jumla almashtirildi 🔄' : 'Пример заменён 🔄');
      return;
    }

    // Build new card text (replicate worker logic)
    const direction = session.direction!;
    const wordEn = review.word.wordEn;
    const isBlankStage = review.stage >= 7;
    let cardText: string;

    if (direction === 'EN_TO_RU') {
      const enLine = isBlankStage
        ? blankTargetInSentence(nextSentence.sentence.en, wordEn)
        : highlightTargetInSentence(nextSentence.sentence.en, wordEn);
      const targetKey = lang === 'uz' ? 'worker.answerTarget.uzbek' : 'worker.answerTarget.russian';
      cardText = `${t(lang, 'worker.rememberWord')}\n\n🗣 ${enLine}\n${t(lang, targetKey)}`;
    } else {
      const nativeTarget = review.word.translationRu;
      const nativeLine = isBlankStage
        ? blankTargetInSentence(nextSentence.sentence.native, nativeTarget)
        : highlightTargetInSentence(nextSentence.sentence.native, nativeTarget);
      cardText = `${t(lang, 'worker.rememberWord')}\n\n🗣 ${nativeLine}\n${t(lang, 'worker.answerTarget.english')}`;
    }

    // Update session payload with new card info
    const newSentenceCount = getSentenceCount(review.word);
    const newSwapData = newSentenceCount >= MIN_SENTENCES_FOR_SWAP
      ? `swap:${review.wordId}:${nextSentence.index}`
      : null;
    const hintTarget = (direction === 'EN_TO_RU' ? review.word.translationRu : review.word.wordEn).trim();
    payload.cardBaseText = cardText;
    payload.hintTarget = hintTarget;
    payload.hintPresses = 0;
    payload.hintReviewId = review.id;
    payload.swapData = newSwapData;
    payload.hintInline = Boolean(isBlankStage && direction === 'EN_TO_RU');

    await prisma.userSession.update({
      where: { userId: BigInt(userId) },
      data: { payload: payload as Prisma.InputJsonValue },
    });

    // Edit (not delete) the message with new sentence
    await ctx.editMessageText(cardText, {
      parse_mode: 'HTML',
      reply_markup: cardInlineKeyboard(review.id, newSwapData),
    });
    await ctx.answerCbQuery(lang === 'uz' ? 'Jumla almashtirildi 🔄' : 'Пример заменён 🔄');
    return;
  }

  if (data === 'notify:toggle') {
    const user = await ensureUser(userId, toTelegramProfile(ctx.from));
    const lang = (user.language as Lang) || 'ru';
    await setNotifications(userId, !user.notificationsEnabled);
    await resetState(BigInt(userId));
    await ctx.answerCbQuery(t(lang, 'notify.toggled'));
    await sendSettings(ctx, userId, 'main', true);
    return;
  }


  await ctx.answerCbQuery();
});

bot.catch((err) => {
  console.error('Bot error', err);
});

export const startBot = () => {
  bot.launch();
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
  return bot;
};

if (require.main === module) {
  startBot();
}

export { bot };


