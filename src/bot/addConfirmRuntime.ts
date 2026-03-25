import type { Context } from 'telegraf';
import type { UserSession } from '../generated/prisma/client';
import { DailyWordLimitError, DuplicateWordError, addWordForUser } from '../services/reviewService';
import { generateSentences, saveSentences } from '../services/sentenceService';
import { resetState, setState } from '../services/sessionService';
import { type Lang, t } from '../i18n';
import { parseAddConfirmCallbackData } from './addConfirmCallbackData';
import { addConfirmEditChoiceKeyboard } from './addConfirmUi';

type AddConfirmSessionSnapshot = Pick<UserSession, 'state' | 'payload'>;

type AddConfirmUser = {
  language: string | null;
};

type LoadUser = (ctx: Context, userId: number) => Promise<AddConfirmUser>;

type FormatPairLine = (
  leftText: string,
  rightText: string,
  uiLang: Lang,
  leftLang?: 'ru' | 'uz' | 'en',
  rightLang?: 'ru' | 'uz' | 'en',
) => string;

type NativeLangForUi = (lang: Lang) => 'ru' | 'uz';

type AddConfirmRuntimeOptions = {
  loadUser: LoadUser;
  formatPairLine: FormatPairLine;
  nativeLangForUi: NativeLangForUi;
};

const asPayload = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

export const createAddConfirmRuntime = ({
  loadUser,
  formatPairLine,
  nativeLangForUi,
}: AddConfirmRuntimeOptions) => {
  const handleAddConfirmCallback = async (
    ctx: Context,
    userId: number,
    data: string,
    session: AddConfirmSessionSnapshot,
  ) => {
    const action = parseAddConfirmCallbackData(data);
    if (!action) return;

    const user = await loadUser(ctx, userId);
    const lang = (user.language as Lang) || 'ru';

    if (action === 'confirm') {
      if (session.state !== 'ADDING_WORD_CONFIRM_TRANSLATION') {
        await ctx.answerCbQuery(t(lang, 'session.lost'));
        return;
      }

      const payload = asPayload(session.payload);
      const wordEn = typeof payload.wordEn === 'string' ? payload.wordEn : '';
      const translation = typeof payload.translationRu === 'string' ? payload.translationRu : '';
      if (!wordEn || !translation) {
        await ctx.answerCbQuery(t(lang, 'session.lost'));
        return;
      }

      try {
        const result = await addWordForUser(BigInt(userId), wordEn, translation);
        const addLang = (lang === 'uz' ? 'uz' : 'ru') as 'ru' | 'uz';
        generateSentences(wordEn, translation, addLang)
          .then((sentences) => sentences && saveSentences(result.wordId, sentences))
          .catch(() => { /* cron will retry */ });
        await resetState(BigInt(userId));
        const pair = formatPairLine(wordEn, translation, lang, 'en', nativeLangForUi(lang));
        await ctx.editMessageText(t(lang, 'add.saved', { pair }), { parse_mode: 'HTML' });
      } catch (error) {
        if (error instanceof DailyWordLimitError) {
          await ctx.reply(t(lang, 'add.dailyLimit', { limit: error.limit }), { parse_mode: 'HTML' });
        } else if (error instanceof DuplicateWordError) {
          await ctx.reply(t(lang, 'add.duplicate', { en: wordEn }), { parse_mode: 'HTML' });
        } else {
          await ctx.reply(error instanceof Error ? error.message : t(lang, 'add.error'), { parse_mode: 'HTML' });
        }
        await resetState(BigInt(userId));
      }

      await ctx.answerCbQuery();
      return;
    }

    if (action === 'change') {
      if (session.state !== 'ADDING_WORD_CONFIRM_TRANSLATION') {
        await ctx.answerCbQuery(t(lang, 'session.lost'));
        return;
      }

      await ctx.answerCbQuery();
      await ctx.editMessageText(t(lang, 'add.editChoice'), {
        parse_mode: 'HTML',
        ...addConfirmEditChoiceKeyboard(lang),
      });
      return;
    }

    if (action === 'changeWord') {
      if (session.state !== 'ADDING_WORD_CONFIRM_TRANSLATION') {
        await ctx.answerCbQuery(t(lang, 'session.lost'));
        return;
      }

      await setState(BigInt(userId), 'ADDING_WORD_WAIT_EN');
      await ctx.answerCbQuery();
      await ctx.editMessageText(t(lang, 'add.manualEnglish'), { parse_mode: 'HTML' });
      return;
    }

    if (action === 'changeTranslation') {
      if (session.state !== 'ADDING_WORD_CONFIRM_TRANSLATION') {
        await ctx.answerCbQuery(t(lang, 'session.lost'));
        return;
      }

      const payload = asPayload(session.payload);
      const nextPayload = typeof payload.wordEn === 'string'
        ? { wordEn: payload.wordEn }
        : {};
      await setState(BigInt(userId), 'ADDING_WORD_WAIT_RU_MANUAL', {
        payload: nextPayload,
      });
      await ctx.answerCbQuery();
      await ctx.editMessageText(t(lang, 'add.manual'), { parse_mode: 'HTML' });
      return;
    }

    await resetState(BigInt(userId));
    await ctx.answerCbQuery();
    await ctx.editMessageText(t(lang, 'add.cancelled'), { parse_mode: 'HTML' });
  };

  return {
    handleAddConfirmCallback,
  };
};
