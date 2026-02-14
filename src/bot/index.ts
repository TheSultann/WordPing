import 'dotenv/config';
import { Context, Markup, Telegraf } from 'telegraf';
import {
  ensureUser,
  recordCompletion,
  setNotifications,
  setQuietHours,
  setNotificationLimit,
  setNotificationInterval,
  resetProgressIfNeeded,
  setLanguage,
  setReferredByIfEmpty,
} from '../services/userService';
import { prisma } from '../db/client';
import { ensureSession, getSession, resetState, setState } from '../services/sessionService';
import { suggestTranslation } from '../services/translation';
import { addWordForUser, applyRating, loadReviewWithWord, DailyWordLimitError, DuplicateWordError } from '../services/reviewService';
import { CardDirection, ReviewResult } from '../generated/prisma';
import { checkAnswer } from '../services/answerChecker';
import { Rating } from '../services/reviewScheduler';
import { minutesToTimeString } from '../utils/time';
import { normalizeWhitespace } from '../utils/text';
import {
  MIN_NOTIFICATION_INTERVAL,
  DEFAULT_MAX_NOTIFICATIONS,
  MAX_NOTIFICATIONS_PER_DAY,
  MIN_NOTIFICATIONS_PER_DAY,
  MAX_NOTIFICATION_INTERVAL,
} from '../services/userService';
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

const webAppUrl = process.env.WEBAPP_URL;
const webAppLabel = (lang: Lang) => (lang === 'uz' ? 'Ilova' : 'Приложение');

const mainReplyKeyboard = (lang: Lang) => {
  if (webAppUrl) {
    return Markup.keyboard([
      [Markup.button.webApp(webAppLabel(lang), webAppUrl)]
    ]).resize().persistent(true);
  }
  return Markup.keyboard([[t(lang, 'btn.settings'), t(lang, 'btn.stats')]]).resize().persistent(true);
};

const openWebAppKeyboard = (lang: Lang) =>
  webAppUrl
    ? Markup.inlineKeyboard([[Markup.button.webApp(webAppLabel(lang), webAppUrl)]])
    : undefined;

const QUIET_WINDOWS = [
  { label: '24/7', start: 0, end: 0 },
  { label: '07-23', start: 420, end: 1380 },
  { label: '08-22', start: 480, end: 1320 },
  { label: '09-23', start: 540, end: 1380 },
  { label: '10-22', start: 600, end: 1320 },
];

const LIMIT_OPTIONS = [10, 20, 30, 40];
const FREQ_OPTIONS = [15, 30, 60, 120];
const PRESETS = {
  standard: { label: 'Стандарт', quiet: { start: 540, end: 1380 }, limit: 20, freq: 30 },
  intensive: { label: 'Интенсив', quiet: { start: 480, end: 1380 }, limit: 30, freq: 20 },
  gentle: { label: 'Щадяще', quiet: { start: 600, end: 1320 }, limit: 10, freq: 60 },
};

const quietLabel = (startMinutes: number, endMinutes: number) => {
  if (startMinutes === endMinutes) return '24/7';
  const end = endMinutes === 0 ? 1440 : endMinutes;
  return `${minutesToTimeString(startMinutes)}-${minutesToTimeString(end)}`;
};

const markButton = (active: boolean, label: string) => (active ? `✅ ${label}` : label);

const detectPreset = (user: any): keyof typeof PRESETS | null => {
  const { quietHoursStartMinutes: s, quietHoursEndMinutes: e, maxNotificationsPerDay: l, notificationIntervalMinutes: f } = user;
  const match = Object.entries(PRESETS).find(
    ([, p]) => p.quiet.start === s && p.quiet.end === e && p.limit === l && p.freq === f
  );
  return match ? (match[0] as keyof typeof PRESETS) : null;
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

const sendSettings = async (ctx: Context, userId: number, view: SettingsView = "main", edit = false) => {
  const fresh = await resetProgressIfNeeded(await ensureUser(userId));
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
  const user = await ensureUser(ctx.from.id);
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
  await ctx.reply(`${t('ru', 'chooseLang')}\n\n${t('uz', 'chooseLang')}`, { parse_mode: 'HTML', ...languageKeyboard });
});

bot.command('app', async (ctx) => {
  if (!ctx.from) return;
  const user = await ensureUser(ctx.from.id);
  const lang = (user.language as Lang) || 'ru';
  if (!webAppUrl) {
    await ctx.reply('WEBAPP_URL is not set', { parse_mode: 'HTML' });
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
  const user = await ensureUser(userId);
  await setState(BigInt(userId), 'ADDING_WORD_WAIT_EN');
  await ctx.reply(t(user.language as Lang, 'add.enter'), { parse_mode: 'HTML' });
});

bot.command('settings', async (ctx) => {
  if (!ctx.from) return;
  const user = await ensureUser(ctx.from.id);
  const lang = (user.language as Lang) || 'ru';
  if (!webAppUrl) {
    await ctx.reply('WEBAPP_URL is not set', { parse_mode: 'HTML' });
    return;
  }
  await ctx.reply(lang === 'uz' ? 'Sozlamalar ilovada' : 'Настройки в приложении', {
    parse_mode: 'HTML',
    ...openWebAppKeyboard(lang),
  });
});

bot.hears([t('ru', 'btn.settings'), t('uz', 'btn.settings')], async (ctx) => {
  if (!ctx.from) return;
  const user = await ensureUser(ctx.from.id);
  const lang = (user.language as Lang) || 'ru';
  if (!webAppUrl) {
    await ctx.reply('WEBAPP_URL is not set', { parse_mode: 'HTML' });
    return;
  }
  await ctx.reply(lang === 'uz' ? 'Sozlamalar ilovada' : 'Настройки в приложении', {
    parse_mode: 'HTML',
    ...openWebAppKeyboard(lang),
  });
});

bot.command('stats', async (ctx) => {
  if (!ctx.from) return;
  const user = await ensureUser(ctx.from.id);
  const lang = (user.language as Lang) || 'ru';
  if (!webAppUrl) {
    await ctx.reply('WEBAPP_URL is not set', { parse_mode: 'HTML' });
    return;
  }
  await ctx.reply(lang === 'uz' ? 'Statistika ilovada' : 'Статистика в приложении', {
    parse_mode: 'HTML',
    ...openWebAppKeyboard(lang),
  });
});

bot.hears([t('ru', 'btn.stats'), t('uz', 'btn.stats')], async (ctx) => {
  if (!ctx.from) return;
  const user = await ensureUser(ctx.from.id);
  const lang = (user.language as Lang) || 'ru';
  if (!webAppUrl) {
    await ctx.reply('WEBAPP_URL is not set', { parse_mode: 'HTML' });
    return;
  }
  await ctx.reply(lang === 'uz' ? 'Statistika ilovada' : 'Статистика в приложении', {
    parse_mode: 'HTML',
    ...openWebAppKeyboard(lang),
  });
});

bot.on('text', async (ctx) => {
  if (!ctx.from || !ctx.message?.text) return;
  const userId = ctx.from.id;
  const user = await ensureUser(userId);
  const lang = (user.language as Lang) || 'ru';
  const session = await getSession(BigInt(userId));
  const text = normalizeWhitespace(ctx.message.text);

  const handleAddFlow = async (wordEn: string) => {
    const suggestion = await suggestTranslation(wordEn);
    const existing = await prisma.word.findFirst({
      where: {
        userId: BigInt(userId),
        wordEn: { equals: wordEn.trim(), mode: 'insensitive' },
      },
    });
    if (existing) {
      await ctx.reply(t(lang, 'add.exists', { en: existing.wordEn, ru: existing.translationRu }), { parse_mode: 'HTML' });
      await resetState(BigInt(userId));
      return;
    }
    if (suggestion) {
      await setState(BigInt(userId), 'ADDING_WORD_CONFIRM_TRANSLATION', {
        payload: { wordEn, translationRu: suggestion },
      });
      await ctx.reply(t(lang, 'add.suggest', { tr: suggestion }), { parse_mode: 'HTML', ...confirmKeyboard(lang) });
    } else {
      await setState(BigInt(userId), 'ADDING_WORD_WAIT_RU_MANUAL', {
        payload: { wordEn },
      });
      await ctx.reply(t(lang, 'add.noSuggest', { en: wordEn }), { parse_mode: 'HTML' });
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
        // Final step of onboarding: Show success, show instructions, reveal keyboard
        await ctx.reply(t(effectiveLang, 'onboarding.finished', { value }), { parse_mode: 'HTML' });
        if (webAppUrl) {
          await ctx.reply(
            effectiveLang === 'uz' ? 'Sozlamalar va statistika ilovada' : 'Настройки и статистика в приложении',
            { parse_mode: 'HTML', ...openWebAppKeyboard(effectiveLang) }
          );
        } else {
          await ctx.reply(t(effectiveLang, 'onboarding.menuTip'), { parse_mode: 'HTML', ...mainReplyKeyboard(effectiveLang) });
        }
        // Do NOT send settings menu here
      } else {
        await ctx.reply(t(effectiveLang, 'settings.interval.saved', { value }), { parse_mode: 'HTML' });
        await sendSettings(ctx, userId, 'main', true);
      }
      break;
    }
    case 'SETTINGS_WAIT_GOAL': {
      const value = parseInt(text, 10);
      if (!Number.isFinite(value)) {
        await ctx.reply(t(lang, 'settings.limit.needNumber'), { parse_mode: 'HTML' });
        return;
      }
      if (value < MIN_NOTIFICATIONS_PER_DAY || value > MAX_NOTIFICATIONS_PER_DAY) {
        await ctx.reply(
          t(lang, 'settings.limit.outRange', { min: MIN_NOTIFICATIONS_PER_DAY, max: MAX_NOTIFICATIONS_PER_DAY }),
          { parse_mode: 'HTML' }
        );
        return;
      }
      await setNotificationLimit(userId, value);
      await resetState(BigInt(userId));
      await ctx.reply(t(lang, 'settings.limit.saved', { value }), { parse_mode: 'HTML' });
      await sendSettings(ctx, userId, 'main', true);
      break;
    }
    case 'ADDING_WORD_WAIT_EN': {
      await handleAddFlow(text);
      break;
    }
    case 'ADDING_WORD_WAIT_RU_MANUAL': {
      const payload = (session.payload as any) || {};
      if (!payload.wordEn) {
        await resetState(BigInt(userId));
        await ctx.reply(t(lang, 'add.failSave'), { parse_mode: 'HTML' });
        return;
      }
      try {
        await addWordForUser(BigInt(userId), payload.wordEn, text);
        await resetState(BigInt(userId));
        await ctx.reply(
          t(lang, 'add.saved', { en: payload.wordEn, ru: text }),
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
      const direction = session.direction;
      const { correct } = checkAnswer(direction, review.word.wordEn, review.word.translationRu, text);
      const correctAnswer = direction === 'RU_TO_EN' ? review.word.wordEn : review.word.translationRu;
      await setState(BigInt(userId), 'WAITING_GRADE', {
        reviewId: session.reviewId,
        wordId: review.wordId,
        direction,
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
    case 'ADDING_WORD_CONFIRM_TRANSLATION': {
      await ctx.reply(t(lang, 'add.confirmPrompt'), { parse_mode: 'HTML' });
      break;
    }
    default:
      if (text.startsWith('/')) return; // игнорируем другие команды
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
    const user = await ensureUser(userId);
    await ctx.answerCbQuery();
    await ctx.reply(t(lang as Lang, 'hint'), {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback(t(lang as Lang, 'btn.next'), 'onboarding:next')]]),
    });
    return;
  }

  if (data === 'onboarding:next') {
    const user = await ensureUser(userId);
    const lang = (user.language as Lang) || 'ru';
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); // remove button
    await setState(BigInt(userId), 'SETTINGS_WAIT_INTERVAL', { payload: { onboarding: { lang } } });
    await ctx.reply(
      t(lang, 'askInterval', {
        current: user.notificationIntervalMinutes,
        min: MIN_NOTIFICATION_INTERVAL,
        max: MAX_NOTIFICATION_INTERVAL,
      }),
      { parse_mode: 'HTML' }
    );
    return;
  }

  if (data.startsWith('settings:')) {
    const view = data.split(':')[1] as SettingsView;
    const user = await ensureUser(userId);
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

  if (data.startsWith('grade:')) {
    const user = await ensureUser(userId);
    const lang = (user.language as Lang) || 'ru';
    if (session.state !== 'WAITING_GRADE' || !session.reviewId || !session.direction) {
      await ctx.answerCbQuery(t(lang, 'grade.noActive'));
      return;
    }
    const rating = data.split(':')[1] as Rating;
    const review = await loadReviewWithWord(session.reviewId);
    if (!review || !review.word) {
      await resetState(BigInt(userId));
      await ctx.answerCbQuery(t(lang, 'session.lost'));
      return;
    }
    const wasCorrect = !!(session.payload as any)?.correct;
    const result: ReviewResult = wasCorrect ? 'CORRECT' : 'INCORRECT';
    await applyRating(review, rating, result, session.direction, session.answerText ?? undefined);

    const progress = await recordCompletion(user);
    const limit = user.maxNotificationsPerDay ?? DEFAULT_MAX_NOTIFICATIONS;
    let progressLine = '';
    if (Number.isFinite(limit) && limit > 0) {
      const done = progress.todayCompleted;
      const left = Math.max(0, limit - done);
      progressLine = left > 0
        ? t(lang, 'grade.progress', { done, limit, left })
        : t(lang, 'grade.limitReached');
    }

    await resetState(BigInt(userId));
    const accepted = t(lang, 'grade.accepted');
    const message = progressLine ? `${accepted}\n${progressLine}` : accepted;
    await ctx.editMessageText(message, { parse_mode: 'HTML' });
    await ctx.answerCbQuery(t(lang, 'grade.saved'));
    return;
  }

  if (data === 'add_confirm') {
    const user = await ensureUser(userId);
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
      await addWordForUser(BigInt(userId), payload.wordEn, payload.translationRu);
      await resetState(BigInt(userId));
      await ctx.editMessageText(
        t(lang, 'add.saved', { en: payload.wordEn, ru: payload.translationRu }),
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
      await ctx.answerCbQuery('Нет слова на редактирование');
      return;
    }
    const payload = (session.payload as any) || {};
    await setState(BigInt(userId), 'ADDING_WORD_WAIT_RU_MANUAL', { payload: { wordEn: payload.wordEn } });
    await ctx.answerCbQuery();
    const user = await ensureUser(userId);
    await ctx.editMessageText(t(user.language as Lang, 'add.manual'), { parse_mode: 'HTML' });
    return;
  }

  if (data === 'add_cancel') {
    const user = await ensureUser(userId);
    const lang = (user.language as Lang) || 'ru';
    await resetState(BigInt(userId));
    await ctx.answerCbQuery();
    await ctx.editMessageText(t(lang, 'add.cancelled'), { parse_mode: 'HTML' });
    return;
  }

  if (data === 'notify:toggle') {
    const user = await ensureUser(userId);
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
