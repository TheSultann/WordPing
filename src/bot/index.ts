import 'dotenv/config';
import { escapeHtml } from '../utils/html';
import type { Context } from 'telegraf';
import { Markup, Telegraf } from 'telegraf';
import { isAddConfirmCallbackData } from './addConfirmCallbackData';
import { createAddConfirmRuntime } from './addConfirmRuntime';
import { addConfirmKeyboard } from './addConfirmUi';
import {
  ensureUser,
  type TelegramProfile,
  markReviewFlowHintShown,
  recordCompletion,
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
import {
  addWordForUser,
  applyRating,
  loadReviewWithWord,
  DailyWordLimitError,
  DuplicateWordError,
  findExistingWordByNormalizedEn,
} from '../services/reviewService';
import { generateSentences, saveSentences, removeSentenceAtIndex, getSentenceForReview, getSentenceCount, MIN_SENTENCES_FOR_SWAP } from '../services/sentenceService';
import { checkAutoTranslateQuota, commitAutoTranslateQuota } from '../services/translationQuota';
import type { ReviewResult } from '../generated/prisma/client';
import { Prisma } from '../generated/prisma/client';
import { checkAnswer } from '../services/answerChecker';
import type { Rating } from '../services/reviewScheduler';
import { createRuntimeHealthReporter } from '../utils/runtimeHealth';
import { normalizeWhitespace } from '../utils/text';
import { buildHintMaskByPress, isHintAvailable } from '../utils/hint';
import {
  MIN_NOTIFICATION_INTERVAL,
  DEFAULT_MAX_NOTIFICATIONS,
  MAX_NOTIFICATIONS_PER_DAY,
  MIN_NOTIFICATIONS_PER_DAY,
  MAX_NOTIFICATION_INTERVAL,
} from '../services/userService';
import { blankTargetInSentence, highlightTargetInSentence } from '../utils/reviewCardText';
import { validateRuntimeEnv } from '../utils/env';
import { createLogger } from '../utils/logger';
import type { Lang } from '../i18n';
import { t } from '../i18n';
import { isNewsDigestCallbackData } from './newsDigestCallbackData';
import { createNewsDigestRuntime } from './newsDigestRuntime';
import { NEWS_DIGEST_BUTTON_BY_LANG, NEWS_DIGEST_BUTTONS } from './newsDigestUi';
import { isQuizCallbackData } from './quizCallbackData';
import { createQuizRuntime } from './quizRuntime';
import { isSettingsCallbackData } from './settingsCallbackData';
import { createSettingsRuntime } from './settingsRuntime';

validateRuntimeEnv('bot');
const botLogger = createLogger('bot');
const botHealth = createRuntimeHealthReporter('bot');

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
const REVIEW_FLOW_HINT_CALLBACK = 'review_flow_hint';

const rawWebAppUrl = (process.env.WEBAPP_URL ?? '').trim();
const parseAppUrl = (value: string): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};
const appUrl = parseAppUrl(rawWebAppUrl);
const webAppUrl = appUrl && appUrl.startsWith('https://') ? appUrl : undefined;
const buildWebAppUrl = (params?: Record<string, string>) => {
  const baseUrl = webAppUrl ?? appUrl;
  if (!baseUrl) return undefined;
  if (!params || Object.keys(params).length === 0) return baseUrl;
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
};
const webAppUnavailableText = rawWebAppUrl
  ? 'WEBAPP_URL must be HTTPS (Telegram does not allow http://).'
  : 'WEBAPP_URL is not set';
if (rawWebAppUrl && !webAppUrl) {
  botLogger.warn('WEBAPP_URL ignored because it is not HTTPS', { webAppUrl: rawWebAppUrl });
}
const webAppLabel = (lang: Lang) => (lang === 'uz' ? 'Ilova' : 'Приложение');


const QUIZ_BUTTON_BY_LANG: Record<Lang, string> = {
  ru: '\u{1F9E0} Quiz',
  uz: '\u{1F9E0} Quiz',
};
const QUIZ_BUTTONS = Object.values(QUIZ_BUTTON_BY_LANG);


const mainReplyKeyboard = (lang: Lang) =>
  Markup.keyboard([[NEWS_DIGEST_BUTTON_BY_LANG[lang], QUIZ_BUTTON_BY_LANG[lang]]]).resize().persistent(true);
const openWebAppKeyboard = (lang: Lang, params?: Record<string, string>, label?: string) => {
  const url = buildWebAppUrl(params);
  if (!url) return undefined;
  return webAppUrl
    ? Markup.inlineKeyboard([[Markup.button.webApp(label ?? webAppLabel(lang), url)]])
    : Markup.inlineKeyboard([[Markup.button.url(label ?? webAppLabel(lang), url)]]);
};
const reviewFlowHintKeyboard = (lang: Lang) =>
  openWebAppKeyboard(lang, { tab: 'settings', flow: 'stages' }, `ℹ️ ${t(lang, 'btn.openGuide')}`)
  ?? Markup.inlineKeyboard([[Markup.button.callback(`ℹ️ ${t(lang, 'btn.openGuide')}`, REVIEW_FLOW_HINT_CALLBACK)]]);
const buildGuideSpoilerText = (lang: Lang) => `<tg-spoiler>${t(lang, 'btn.openGuide')}</tg-spoiler>`;
const buildGuideSpoilerLinkText = (lang: Lang) => {
  const guideUrl = buildWebAppUrl({ tab: 'settings', flow: 'stages' });
  if (guideUrl) {
    return `<a href="${guideUrl}">${buildGuideSpoilerText(lang)}</a>`;
  }
  return buildGuideSpoilerText(lang);
};
const buildGuideLinkText = (lang: Lang) => {
  const guideUrl = buildWebAppUrl({ tab: 'settings', flow: 'stages' });
  if (guideUrl) {
    return `<a href="${guideUrl}">${t(lang, 'btn.openGuide')}</a>`;
  }
  return buildGuideSpoilerText(lang);
};
const newsDigestRuntime = createNewsDigestRuntime({ mainReplyKeyboard, buildGuideLinkText });
const settingsRuntime = createSettingsRuntime({
  loadUser: (ctx, userId) => ensureUser(userId, toTelegramProfile(ctx.from)),
});
const quizRuntime = createQuizRuntime({ bot, mainReplyKeyboard, buildGuideLinkText });
export const runQuizQuestionTimeout = quizRuntime.runQuizQuestionTimeout;
export const restoreActiveQuizTimeouts = quizRuntime.restoreActiveQuizTimeouts;

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

const addConfirmRuntime = createAddConfirmRuntime({
  loadUser: (ctx, userId) => ensureUser(userId, toTelegramProfile(ctx.from)),
  formatPairLine,
  nativeLangForUi,
});

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
const isRating = (value: string): value is Rating => value === 'HARD' || value === 'GOOD' || value === 'EASY';

const cardInlineKeyboard = (reviewId: number, swapData?: string | null, hintEnabled = true) => {
  const row: Array<{ text: string; callback_data: string }> = [];
  if (hintEnabled) row.push({ text: '💡', callback_data: `hint:${reviewId}` });
  if (swapData) row.push({ text: '🔄', callback_data: swapData });
  return row.length > 0 ? { inline_keyboard: [row] } : undefined;
};



const languageKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('🇷🇺 Русский', 'lang:ru'), Markup.button.callback('🇺🇿 O‘zbekcha', 'lang:uz')],
]);
const chooseLangText = '\u{1F310} Tilni tanlang / \u0412\u044B\u0431\u0435\u0440\u0438 \u044F\u0437\u044B\u043A';
const onboardingNextKeyboard = (lang: Lang) =>
  Markup.inlineKeyboard([[Markup.button.callback(t(lang, 'btn.next'), 'onboarding:next')]]);

const sendChooseLangPrompt = async (ctx: Context) => {
  await ctx.reply(chooseLangText, { parse_mode: 'HTML', ...languageKeyboard });
};

const sendOnboardingHintPrompt = async (ctx: Context, lang: Lang) => {
  await ctx.reply(t(lang, 'hint'), {
    parse_mode: 'HTML',
    ...onboardingNextKeyboard(lang),
  });
};

const getPendingOnboardingStep = (session: { payload?: unknown } | null | undefined): 'lang' | 'intro' | null => {
  const step = (session?.payload as any)?.onboarding?.step;
  return step === 'lang' || step === 'intro' ? step : null;
};

const replyIfOnboardingPending = async (
  ctx: Context,
  session: { payload?: unknown } | null | undefined,
  fallbackLang: Lang
) => {
  const step = getPendingOnboardingStep(session);
  if (!step) return false;
  if (step === 'lang') {
    await sendChooseLangPrompt(ctx);
    return true;
  }

  const onboardingLang = (session?.payload as any)?.onboarding?.lang;
  const lang = onboardingLang === 'uz' || onboardingLang === 'ru' ? onboardingLang : fallbackLang;
  await sendOnboardingHintPrompt(ctx, lang);
  return true;
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
  await sendChooseLangPrompt(ctx);
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
  const lang = (user.language as Lang) || 'ru';
  const session = await getSession(BigInt(userId));
  if (await replyIfOnboardingPending(ctx, session, lang)) return;
  await setState(BigInt(userId), 'ADDING_WORD_WAIT_EN');
  await ctx.reply(t(lang, 'add.enter'), { parse_mode: 'HTML' });
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
  const session = await getSession(BigInt(user.id));
  if (await replyIfOnboardingPending(ctx, session, lang)) return;
  await quizRuntime.handleQuizStart(ctx, BigInt(user.id), lang);
});

bot.hears(NEWS_DIGEST_BUTTONS, async (ctx) => {
  if (!ctx.from) return;

  const user = await ensureUser(ctx.from.id, toTelegramProfile(ctx.from));
  const lang = ((user.language as Lang) || 'ru');
  const session = await getSession(BigInt(user.id));
  if (await replyIfOnboardingPending(ctx, session, lang)) return;
  await newsDigestRuntime.handleNewsDigestStart(ctx, BigInt(user.id), lang);
});

bot.on('text', async (ctx) => {
  if (!ctx.from || !ctx.message?.text) return;
  const userId = ctx.from.id;
  const user = await ensureUser(userId, toTelegramProfile(ctx.from));
  const lang = (user.language as Lang) || 'ru';
  const session = await getSession(BigInt(userId));
  const text = normalizeWhitespace(ctx.message.text);

  const findExistingWord = async (wordEn: string) => {
    return findExistingWordByNormalizedEn(BigInt(userId), wordEn);
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
          botLogger.warn('Auto-translate quota commit skipped due to concurrent limit usage', {
            userId,
            limit: committed.limit,
            used: committed.used,
          });
          await ctx.reply(t(lang, 'add.apiLimitReachedNow', { limit: committed.limit }), {
            parse_mode: 'HTML',
          });
        }
      }
      await setState(BigInt(userId), 'ADDING_WORD_CONFIRM_TRANSLATION', {
        payload: { wordEn: finalEn, translationRu: finalTranslation },
      });
      await ctx.deleteMessage(searchingMsg.message_id).catch(() => { });
      await ctx.reply(t(lang, 'add.suggest', { pair }), { parse_mode: 'HTML', ...addConfirmKeyboard(lang) });
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
        await ctx.reply(t(effectiveLang, 'onboarding.finished', {
          value,
          guideLink: buildGuideSpoilerLinkText(effectiveLang),
        }), {
          parse_mode: 'HTML',
          ...mainReplyKeyboard(effectiveLang),
        });
        // Do NOT send settings menu here
      } else {
        await ctx.reply(t(effectiveLang, 'settings.interval.saved', { value }), { parse_mode: 'HTML' });
        await settingsRuntime.sendSettings(ctx, userId, 'main', true);
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
        await settingsRuntime.sendSettings(ctx, userId, 'main', true);
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
      await quizRuntime.handleQuizActiveText(ctx, BigInt(userId), lang, text, session);
      break;
    }
    case 'ADDING_WORD_CONFIRM_TRANSLATION': {
      await ctx.reply(t(lang, 'add.confirmPrompt'), { parse_mode: 'HTML' });
      break;
    }
    default:
      if (text.startsWith('/')) return; // ignore other commands
      if (await replyIfOnboardingPending(ctx, session, lang)) return;
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
    await ensureUser(userId, toTelegramProfile(ctx.from));
    await setState(BigInt(userId), 'IDLE', { payload: { lang, onboarding: { step: 'intro', lang } } });
    await ctx.answerCbQuery();
    await sendOnboardingHintPrompt(ctx, lang);
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

  if (isQuizCallbackData(data)) {
    const user = await ensureUser(userId, toTelegramProfile(ctx.from));
    const lang = (user.language as Lang) || 'ru';
    await quizRuntime.handleQuizCallback(ctx, BigInt(userId), lang, data, session);
    return;
  }

  if (isNewsDigestCallbackData(data)) {
    const user = await ensureUser(userId, toTelegramProfile(ctx.from));
    const lang = (user.language as Lang) || 'ru';
    await newsDigestRuntime.handleNewsDigestCallback(ctx, BigInt(userId), lang, data, session);
    return;
  }

  if (isSettingsCallbackData(data)) {
    await settingsRuntime.handleSettingsCallback(ctx, userId, data);
    return;
  }

  if (data === REVIEW_FLOW_HINT_CALLBACK) {
    const user = await ensureUser(userId, toTelegramProfile(ctx.from));
    const lang = (user.language as Lang) || 'ru';
    await ctx.answerCbQuery(t(lang, 'reviewFlowHint'), { show_alert: true });
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
    if (!isHintAvailable(target)) {
      await ctx.answerCbQuery(t(lang, 'worker.hintUnavailable'));
      return;
    }

    const nextPress = currentPresses + 1;
    const masked = buildHintMaskByPress(target, nextPress);
    if (!masked) {
      await ctx.answerCbQuery(t(lang, 'worker.hintUnavailable'));
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

    const replyMarkup = cardInlineKeyboard(reviewId, swapData, true);
    await ctx.editMessageText(nextText, {
      parse_mode: 'HTML',
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
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
    const rawRating = data.split(':')[1] ?? '';
    if (!isRating(rawRating)) {
      await ctx.answerCbQuery(t(lang, 'grade.noActive'));
      return;
    }
    const reviewId = session.reviewId;
    const direction = session.direction;
    const answerText = session.answerText ?? undefined;
    const wasCorrect = !!(session.payload as any)?.correct;
    const claim = await prisma.userSession.updateMany({
      where: {
        userId: BigInt(userId),
        state: 'WAITING_GRADE',
        reviewId,
        direction,
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
    const rating: Rating = rawRating;
    const review = await loadReviewWithWord(reviewId);
    if (!review || !review.word) {
      await ctx.answerCbQuery(t(lang, 'session.lost'));
      return;
    }
    const isInitialStageZeroReview = review.stage === 0 && review.lastReviewAt === null;
    const result: ReviewResult = wasCorrect ? 'CORRECT' : 'INCORRECT';
    await applyRating(review, rating, result, direction, answerText);

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
    let showReviewFlowHintButton = false;

    if (isInitialStageZeroReview) {
      const remainingUnseenDirections = await prisma.review.count({
        where: {
          wordId: review.wordId,
          lastReviewAt: null,
        },
      });

      if (remainingUnseenDirections === 0 && await markReviewFlowHintShown(userId)) {
        showReviewFlowHintButton = true;
      }
    }

    const messageParts = [accepted];
    if (progressLine) messageParts.push(progressLine);

    await ctx.editMessageText(messageParts.join('\n'), {
      parse_mode: 'HTML',
      ...(showReviewFlowHintButton ? reviewFlowHintKeyboard(lang) : {}),
    });
    await ctx.answerCbQuery(t(lang, 'grade.saved'));
    return;
  }

  if (isAddConfirmCallbackData(data)) {
    await addConfirmRuntime.handleAddConfirmCallback(ctx, userId, data, session);
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
    const hintEnabled = isHintAvailable(hintTarget);
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
    const replyMarkup = cardInlineKeyboard(review.id, newSwapData, hintEnabled);
    await ctx.editMessageText(cardText, {
      parse_mode: 'HTML',
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
    await ctx.answerCbQuery(lang === 'uz' ? 'Jumla almashtirildi 🔄' : 'Пример заменён 🔄');
    return;
  }

  await ctx.answerCbQuery();
});

bot.catch((err) => {
  botHealth.markError(err instanceof Error ? err.message : 'bot error');
  botLogger.error('bot error', { error: err });
});

export const startBot = async () => {
  botHealth.start();
  botHealth.markError('bot starting');
  botLogger.info('bot starting', { webAppConfigured: Boolean(webAppUrl) });
  try {
    await bot.telegram.getMe();
  } catch (error) {
    botHealth.markError(error instanceof Error ? error.message : 'bot launch failed');
    botLogger.error('bot launch failed', { error });
    throw error;
  }

  try {
    await Promise.race([
      bot.launch(),
      new Promise((resolve) => setTimeout(resolve, 50))
    ]);
  } catch (error) {
    botHealth.markError(error instanceof Error ? error.message : 'bot launch failed');
    botLogger.error('bot launch failed', { error });
    throw error;
  }

  // We only run this after a short delay so that synchronous errors from launch (in tests or bad webhooks) throw first
  botHealth.markOk('bot launched');
  botLogger.info('bot launched', { webAppConfigured: Boolean(webAppUrl) });
  void restoreActiveQuizTimeouts().catch((error) => {
    botHealth.markError(error instanceof Error ? error.message : 'quiz restore failed');
    botLogger.error('quiz restore failed', { error });
  });
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
  return bot;
};

if (require.main === module) {
  void startBot().catch(() => {
    process.exitCode = 1;
  });
}

export { bot };



