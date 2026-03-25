import type { Context, Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import type { Prisma} from '../generated/prisma/client';
import { type QuizRunStatus, type UserSession } from '../generated/prisma/client';
import { prisma } from '../db/client';
import { hasLang, type Lang, t } from '../i18n';
import {
  finishQuiz,
  getCurrentQuestion,
  QUIZ_DAILY_LIMIT,
  startOrResumeQuiz,
  submitAnswer,
  type QuizQuestionView,
  type QuizSummary,
} from '../services/quizService';
import { getSession, resetState, setState } from '../services/sessionService';
import { createLogger } from '../utils/logger';
import { normalizeWhitespace } from '../utils/text';
import {
  isQuizCallbackData,
  parseQuizCallbackData,
  quizCancelStartCallback,
  quizStartCallback,
} from './quizCallbackData';
import {
  asQuizPayloadRecord,
  parseQuizMessageRefFromPayload,
  parseQuizQuestionIdFromPayload,
  parseQuizRunIdFromPayload,
  parseQuizServiceMessageRefFromPayload,
  type QuizMessageRef,
} from './quizPayload';
import {
  quizAccuracy,
  quizAlreadyHandledText,
  quizAnswerToastText,
  quizQuestionKeyboard,
  quizQuestionText,
  quizSummaryText,
} from './quizUi';

type MainReplyKeyboardFactory = (lang: Lang) => ReturnType<typeof Markup.keyboard>;

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

export type QuizTimeoutTask = {
  userId: bigint;
  lang: Lang;
  runId: number;
  questionId: number;
  message: QuizMessageRef;
};

type QuizSessionSnapshot = Pick<UserSession, 'state' | 'payload'>;

type QuizServiceAction = 'TIRED';

type QuizRuntimeOptions = {
  bot: Telegraf<Context>;
  mainReplyKeyboard: MainReplyKeyboardFactory;
};

const quizRuntimeLogger = createLogger('bot').child({ component: 'quiz-runtime' });

const QUIZ_SERVICE_TIRED_BY_LANG: Record<Lang, string> = {
  ru: '😮‍💨 Я устал',
  uz: '😮‍💨 Charchadim',
};

const QUIZ_TEXT_NUDGE_COOLDOWN_MS = 30_000;

const normalizeActionText = (value: string): string => normalizeWhitespace(value).toLowerCase();

const resolveQuizServiceAction = (value: string): QuizServiceAction | null => {
  const normalized = normalizeActionText(value);
  if (!normalized) return null;

  const tiredButtons = [...Object.values(QUIZ_SERVICE_TIRED_BY_LANG), 'Я устал', 'Charchadim'].map(normalizeActionText);
  if (tiredButtons.includes(normalized)) return 'TIRED';

  const legacyExitButtons = ['Выход', 'Chiqish'].map(normalizeActionText);
  if (legacyExitButtons.includes(normalized)) return 'TIRED';

  return null;
};

const quizLimitReachedText = (lang: Lang, usedToday: number): string =>
  lang === 'uz'
    ? `Bugungi Quiz limiti tugadi: ${QUIZ_DAILY_LIMIT}. Ishlatildi: ${usedToday}/${QUIZ_DAILY_LIMIT}.`
    : `Дневной лимит Quiz исчерпан: ${usedToday}/${QUIZ_DAILY_LIMIT}.`;

const quizInsufficientWordsText = (lang: Lang, minRequiredWords: number): string =>
  lang === 'uz'
    ? `Quiz uchun kamida ${minRequiredWords} ta stage>=2 soz kerak.`
    : `Для Quiz нужно минимум ${minRequiredWords} слов со stage>=2.`;

const quizPendingFlowText = (lang: Lang): string =>
  lang === 'uz'
    ? 'Siz boshqa jarayondasiz. Quizni boshlasak, hozirgi holat yopiladi.'
    : 'У вас есть незавершённое действие. Если открыть Quiz, текущий процесс закроется.';

const quizStartConfirmText = (lang: Lang): string =>
  lang === 'uz'
    ? 'Quizni baribir boshlaymizmi?'
    : 'Всё равно открыть Quiz?';

const quizStartCancelledText = (lang: Lang): string =>
  lang === 'uz'
    ? 'Quiz bekor qilindi.'
    : 'Запуск Quiz отменён.';

const quizStartConfirmKeyboard = (lang: Lang) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback(lang === 'uz' ? 'Ha, boshlash' : 'Да, открыть', quizStartCallback()),
      Markup.button.callback(lang === 'uz' ? "Yo'q" : 'Нет', quizCancelStartCallback()),
    ],
  ]);

const quizUseButtonsText = (lang: Lang): string =>
  lang === 'uz'
    ? 'Quiz aktiv. Javobni tugmalar bilan bering.'
    : 'Quiz активен. Отвечайте кнопками.';

const quizStoppedText = (lang: Lang): string =>
  lang === 'uz'
    ? 'Quiz to‘xtatildi.'
    : 'Квиз остановлен.';

const quizUnavailableText = (lang: Lang): string =>
  lang === 'uz'
    ? 'Quiz vaqtincha mavjud emas. Keyinroq qayta urinib koring.'
    : 'Quiz временно недоступен. Попробуйте позже.';

const quizStartFailedText = (lang: Lang): string =>
  lang === 'uz'
    ? 'Quizni boshlab bolmadi. Qayta urinib koring.'
    : 'Не удалось запустить Quiz. Попробуйте снова.';

const quizStartErrorText = (lang: Lang): string =>
  lang === 'uz'
    ? 'Quiz xatosi. Qayta urinib koring.'
    : 'Ошибка Quiz. Попробуйте снова.';

const quizCallbackErrorText = (lang: Lang): string =>
  lang === 'uz'
    ? 'Quiz xatosi.'
    : 'Ошибка Quiz.';

const shouldSendQuizTextNudge = (payload: Record<string, unknown> | null): boolean => {
  const raw = typeof payload?.quizTextNudgeAt === 'string' ? payload.quizTextNudgeAt : '';
  if (!raw) return true;
  const last = Date.parse(raw);
  if (!Number.isFinite(last)) return true;
  return Date.now() - last >= QUIZ_TEXT_NUDGE_COOLDOWN_MS;
};

const prismaErrorCode = (error: unknown): string | null => {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
};

const isQuizSchemaMissingError = (error: unknown): boolean => {
  const code = prismaErrorCode(error);
  return code === 'P2021' || code === 'P2022';
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

export const createQuizRuntime = ({ bot, mainReplyKeyboard }: QuizRuntimeOptions) => {
  const quizTimeouts = new Map<number, ReturnType<typeof setTimeout>>();

  const clearScheduledQuizTimeout = (runId: number): void => {
    const handle = quizTimeouts.get(runId);
    if (!handle) return;
    clearTimeout(handle);
    quizTimeouts.delete(runId);
  };

  const quizServiceReplyKeyboard = (lang: Lang) =>
    Markup.keyboard([[
      {
        text: QUIZ_SERVICE_TIRED_BY_LANG[lang],
        style: 'danger',
      } as any,
    ]]).resize().persistent(true);

  const clearQuizInlineKeyboard = async (ctx: Context): Promise<void> => {
    if (!('editMessageReplyMarkup' in ctx)) return;
    try {
      await (ctx as any).editMessageReplyMarkup({ inline_keyboard: [] });
    } catch {
      // ignore stale/non-editable messages
    }
  };

  const clearQuizInlineKeyboardByMessageRef = async (message: QuizMessageRef | null): Promise<void> => {
    if (!message) return;
    try {
      await bot.telegram.editMessageReplyMarkup(message.chatId, message.messageId, undefined, { inline_keyboard: [] });
    } catch {
      // ignore stale/non-editable messages
    }
  };

  const deleteQuizMessageByRef = async (message: QuizMessageRef | null): Promise<void> => {
    if (!message) return;
    try {
      await bot.telegram.deleteMessage(message.chatId, message.messageId);
    } catch {
      // ignore already deleted/non-deletable messages
    }
  };

  const sendQuizFinalReply = async (
    ctx: Context,
    lang: Lang,
    summary: QuizSummary | null,
    fallbackText?: string,
    serviceMessage?: QuizMessageRef | null,
  ): Promise<void> => {
    await clearQuizInlineKeyboard(ctx);
    await deleteQuizMessageByRef(serviceMessage ?? null);
    if (summary) {
      await ctx.reply(quizSummaryText(lang, summary), {
        parse_mode: 'HTML',
        ...mainReplyKeyboard(lang),
      });
      return;
    }

    await ctx.reply(fallbackText ?? quizStoppedText(lang), {
      ...mainReplyKeyboard(lang),
    });
  };

  const sendQuizFinalToChat = async (
    chatId: number,
    lang: Lang,
    summary: QuizSummary | null,
    message: QuizMessageRef | null,
    fallbackText?: string,
    serviceMessage?: QuizMessageRef | null,
  ): Promise<void> => {
    await clearQuizInlineKeyboardByMessageRef(message);
    await deleteQuizMessageByRef(serviceMessage ?? null);
    if (summary) {
      await bot.telegram.sendMessage(chatId, quizSummaryText(lang, summary), {
        parse_mode: 'HTML',
        ...mainReplyKeyboard(lang),
      });
      return;
    }

    await bot.telegram.sendMessage(chatId, fallbackText ?? quizStoppedText(lang), {
      ...mainReplyKeyboard(lang),
    });
  };

  const activateQuizServiceKeyboard = async (ctx: Context, lang: Lang): Promise<QuizMessageRef | null> => {
    const serviceMessage = await ctx.reply('----------------------------------------', {
      ...quizServiceReplyKeyboard(lang),
    });
    const chatId = serviceMessage?.chat?.id ?? ctx.chat?.id;
    const messageId = serviceMessage?.message_id;
    if (typeof chatId !== 'number' || typeof messageId !== 'number') return null;
    return { chatId, messageId };
  };

  const rememberQuizQuestionState = async (
    userId: bigint,
    lang: Lang,
    runId: number,
    question: QuizQuestionView,
    message: QuizMessageRef,
    serviceMessage?: QuizMessageRef | null,
  ): Promise<void> => {
    await setState(userId, 'QUIZ_ACTIVE', {
      payload: {
        lang,
        quizRunId: runId,
        quizQuestionId: question.questionId,
        quizChatId: message.chatId,
        quizMessageId: message.messageId,
        ...(serviceMessage
          ? {
              quizServiceChatId: serviceMessage.chatId,
              quizServiceMessageId: serviceMessage.messageId,
            }
          : {}),
      },
    });
  };

  const rememberQuizRunOnlyState = async (
    userId: bigint,
    lang: Lang,
    runId: number,
    serviceMessage?: QuizMessageRef | null,
  ): Promise<void> => {
    await setState(userId, 'QUIZ_ACTIVE', {
      payload: {
        lang,
        quizRunId: runId,
        ...(serviceMessage
          ? {
              quizServiceChatId: serviceMessage.chatId,
              quizServiceMessageId: serviceMessage.messageId,
            }
          : {}),
      },
    });
  };

  const sendQuizQuestionReply = async (
    ctx: Context,
    lang: Lang,
    question: QuizQuestionView,
  ): Promise<QuizMessageRef | null> => {
    const sent = await ctx.reply(quizQuestionText(lang, question), {
      parse_mode: 'HTML' as const,
      ...quizQuestionKeyboard(lang, question),
    });
    const chatId = sent?.chat?.id ?? ctx.chat?.id;
    const messageId = sent?.message_id;
    if (typeof chatId !== 'number' || typeof messageId !== 'number') return null;
    return { chatId, messageId };
  };

  const upsertQuizQuestionFromContext = async (
    ctx: Context,
    lang: Lang,
    question: QuizQuestionView,
  ): Promise<QuizMessageRef | null> => {
    const callbackMessage = (ctx.callbackQuery as any)?.message;
    const chatId = callbackMessage?.chat?.id;
    const messageId = callbackMessage?.message_id;
    const text = quizQuestionText(lang, question);
    const extra = { parse_mode: 'HTML' as const, ...quizQuestionKeyboard(lang, question) };

    if (typeof chatId === 'number' && typeof messageId === 'number') {
      try {
        await bot.telegram.editMessageText(chatId, messageId, undefined, text, extra);
        return { chatId, messageId };
      } catch {
        // fallback to a fresh message below
      }
    }

    const sent = await ctx.reply(text, extra);
    const nextChatId = sent?.chat?.id ?? ctx.chat?.id;
    const nextMessageId = sent?.message_id;
    if (typeof nextChatId !== 'number' || typeof nextMessageId !== 'number') return null;
    return { chatId: nextChatId, messageId: nextMessageId };
  };

  const upsertQuizQuestionByMessageRef = async (
    message: QuizMessageRef,
    lang: Lang,
    question: QuizQuestionView,
  ): Promise<QuizMessageRef> => {
    const text = quizQuestionText(lang, question);
    const extra = { parse_mode: 'HTML' as const, ...quizQuestionKeyboard(lang, question) };

    try {
      await bot.telegram.editMessageText(message.chatId, message.messageId, undefined, text, extra);
      return message;
    } catch {
      const sent = await bot.telegram.sendMessage(message.chatId, text, extra);
      return {
        chatId: sent.chat.id,
        messageId: sent.message_id,
      };
    }
  };

  const scheduleQuizQuestionTimeout = (
    task: QuizTimeoutTask,
    expiresAt: Date,
  ): void => {
    clearScheduledQuizTimeout(task.runId);
    const delayMs = Math.max(0, expiresAt.getTime() - Date.now());
    const handle = setTimeout(() => {
      void runQuizQuestionTimeout(task);
    }, delayMs);
    handle.unref?.();
    quizTimeouts.set(task.runId, handle);
  };

  const handleAnsweredQuestion = async (
    ctx: Context,
    userId: bigint,
    lang: Lang,
    runId: number,
    serviceMessage: QuizMessageRef | null,
    result: Extract<Awaited<ReturnType<typeof submitAnswer>>, { ok: true }>,
  ): Promise<void> => {
    if (result.summary && result.summary.status !== 'ACTIVE') {
      clearScheduledQuizTimeout(runId);
      await resetState(userId);
      await sendQuizFinalReply(ctx, lang, result.summary, undefined, serviceMessage);
      await ctx.answerCbQuery(quizAnswerToastText(lang, result));
      return;
    }

    if (result.nextQuestion) {
      const nextMessage = await upsertQuizQuestionFromContext(ctx, lang, result.nextQuestion);
      if (nextMessage) {
        await rememberQuizQuestionState(userId, lang, runId, result.nextQuestion, nextMessage, serviceMessage);
        scheduleQuizQuestionTimeout({
          userId,
          lang,
          runId,
          questionId: result.nextQuestion.questionId,
          message: nextMessage,
        }, result.nextQuestion.expiresAt);
      } else {
        await rememberQuizRunOnlyState(userId, lang, runId, serviceMessage);
      }
      await ctx.answerCbQuery(quizAnswerToastText(lang, result));
      return;
    }

    clearScheduledQuizTimeout(runId);
    await rememberQuizRunOnlyState(userId, lang, runId);
    await ctx.answerCbQuery(quizAnswerToastText(lang, result));
  };

  const runQuizQuestionTimeout = async (task: QuizTimeoutTask): Promise<void> => {
    clearScheduledQuizTimeout(task.runId);

    try {
      const session = await getSession(task.userId);
      if (session.state !== 'QUIZ_ACTIVE') return;

      const payload = asQuizPayloadRecord(session.payload);
      const activeRunId = parseQuizRunIdFromPayload(payload);
      const activeQuestionId = parseQuizQuestionIdFromPayload(payload);
      const activeMessage = parseQuizMessageRefFromPayload(payload) ?? task.message;
      const activeServiceMessage = parseQuizServiceMessageRefFromPayload(payload);
      const payloadLang = typeof payload?.lang === 'string' ? payload.lang : '';
      const activeLang = hasLang(payloadLang)
        ? payloadLang as Lang
        : task.lang;

      if (activeRunId !== task.runId || activeQuestionId !== task.questionId) return;

      const result = await submitAnswer(task.runId, task.questionId, null, null);
      if (!result.ok) {
        if (result.reason === 'RUN_NOT_ACTIVE') {
          const latest = await loadQuizRunSnapshot(task.userId, task.runId);
          if (latest) {
            await resetState(task.userId);
            await sendQuizFinalToChat(
              activeMessage.chatId,
              activeLang,
              toQuizSummaryFromRun(latest),
              activeMessage,
              undefined,
              activeServiceMessage,
            );
          }
        }
        return;
      }

      if (result.duplicate) return;

      if (result.summary && result.summary.status !== 'ACTIVE') {
        await resetState(task.userId);
        await sendQuizFinalToChat(activeMessage.chatId, activeLang, result.summary, activeMessage, undefined, activeServiceMessage);
        return;
      }

      if (!result.nextQuestion) return;

      const nextMessage = await upsertQuizQuestionByMessageRef(activeMessage, activeLang, result.nextQuestion);
      await rememberQuizQuestionState(task.userId, activeLang, task.runId, result.nextQuestion, nextMessage, activeServiceMessage);
      scheduleQuizQuestionTimeout({
        userId: task.userId,
        lang: activeLang,
        runId: task.runId,
        questionId: result.nextQuestion.questionId,
        message: nextMessage,
      }, result.nextQuestion.expiresAt);
    } catch (error) {
      quizRuntimeLogger.error('quiz auto-timeout failed', {
        userId: task.userId.toString(),
        runId: task.runId,
        questionId: task.questionId,
        error,
      });
    }
  };

  const restoreActiveQuizTimeouts = async (): Promise<void> => {
    const sessions = await prisma.userSession.findMany({
      where: { state: 'QUIZ_ACTIVE' },
      select: {
        userId: true,
        payload: true,
        user: {
          select: {
            language: true,
          },
        },
      },
    });

    for (const session of sessions) {
      try {
        const payload = asQuizPayloadRecord(session.payload);
        const runId = parseQuizRunIdFromPayload(payload);
        const message = parseQuizMessageRefFromPayload(payload);
        if (!runId || !message) {
          await resetState(session.userId);
          continue;
        }

        const question = await getCurrentQuestion(runId);
        if (!question) {
          await resetState(session.userId);
          continue;
        }

        const payloadLang = typeof payload?.lang === 'string' ? payload.lang : null;
        const lang = hasLang(payloadLang ?? '') ? payloadLang as Lang : ((session.user.language as Lang) || 'ru');
        const serviceMessage = parseQuizServiceMessageRefFromPayload(payload);

        await rememberQuizQuestionState(session.userId, lang, runId, question, message, serviceMessage);
        scheduleQuizQuestionTimeout({
          userId: session.userId,
          lang,
          runId,
          questionId: question.questionId,
          message,
        }, question.expiresAt);
      } catch (error) {
        quizRuntimeLogger.error('quiz restore session failed', {
          userId: session.userId.toString(),
          error,
        });
      }
    }
  };

  const startQuizFlow = async (
    ctx: Context,
    userId: bigint,
    lang: Lang,
    session: QuizSessionSnapshot,
  ): Promise<void> => {
    const result = await startOrResumeQuiz(userId);
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
      await resetState(userId);
      await ctx.reply(quizSummaryText(lang, result.summary), { parse_mode: 'HTML', ...mainReplyKeyboard(lang) });
      return;
    }

    if (!result.question) {
      await resetState(userId);
      await ctx.reply(quizStartFailedText(lang), {
        parse_mode: 'HTML',
        ...mainReplyKeyboard(lang),
      });
      return;
    }

    await deleteQuizMessageByRef(parseQuizServiceMessageRefFromPayload(session.payload));
    const serviceMessage = await activateQuizServiceKeyboard(ctx, lang);
    const questionMessage = await sendQuizQuestionReply(ctx, lang, result.question);
    if (questionMessage) {
      await rememberQuizQuestionState(userId, lang, result.runId, result.question, questionMessage, serviceMessage);
      scheduleQuizQuestionTimeout({
        userId,
        lang,
        runId: result.runId,
        questionId: result.question.questionId,
        message: questionMessage,
      }, result.question.expiresAt);
    } else {
      await rememberQuizRunOnlyState(userId, lang, result.runId, serviceMessage);
    }
  };

  const handleQuizStart = async (
    ctx: Context,
    userId: bigint,
    lang: Lang,
  ): Promise<void> => {
    try {
      const session = await getSession(userId);

      if (session.state !== 'IDLE' && session.state !== 'QUIZ_ACTIVE') {
        await ctx.reply(`${quizPendingFlowText(lang)}\n\n${quizStartConfirmText(lang)}`, {
          parse_mode: 'HTML',
          ...quizStartConfirmKeyboard(lang),
        });
        return;
      }

      await startQuizFlow(ctx, userId, lang, session);
    } catch (error) {
      quizRuntimeLogger.error('quiz start failed', { userId: userId.toString(), error });
      if (isQuizSchemaMissingError(error)) {
        await ctx.reply(quizUnavailableText(lang), { ...mainReplyKeyboard(lang) });
        return;
      }
      await ctx.reply(quizStartErrorText(lang), {
        ...mainReplyKeyboard(lang),
      });
    }
  };

  const handleQuizActiveText = async (
    ctx: Context,
    userId: bigint,
    lang: Lang,
    text: string,
    session: QuizSessionSnapshot,
  ): Promise<void> => {
    const action = resolveQuizServiceAction(text);
    if (action === 'TIRED') {
      const runId = parseQuizRunIdFromPayload(session.payload);
      const message = parseQuizMessageRefFromPayload(session.payload);
      const serviceMessage = parseQuizServiceMessageRefFromPayload(session.payload);
      if (runId) {
        clearScheduledQuizTimeout(runId);
      }
      await deleteQuizMessageByRef(message);
      let summary: QuizSummary | null = null;
      if (runId) {
        summary = await finishQuiz(runId);
      }
      await resetState(userId);
      await sendQuizFinalReply(ctx, lang, summary, undefined, serviceMessage);
      return;
    }

    const payload = asQuizPayloadRecord(session.payload);
    if (!shouldSendQuizTextNudge(payload)) {
      return;
    }

    await prisma.userSession.update({
      where: { userId },
      data: {
        payload: {
          ...(payload ?? {}),
          quizTextNudgeAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
    await ctx.reply(quizUseButtonsText(lang), { parse_mode: 'HTML' });
  };

  const handleQuizCallback = async (
    ctx: Context,
    userId: bigint,
    lang: Lang,
    data: string,
    session: QuizSessionSnapshot,
  ): Promise<void> => {
    if (!isQuizCallbackData(data)) return;

    const parsed = parseQuizCallbackData(data);
    const serviceMessage = parseQuizServiceMessageRefFromPayload(session.payload);

    try {
      if (!parsed || parsed.action === 'invalid') {
        await ctx.answerCbQuery(lang === 'uz' ? 'Quiz callback notogri.' : 'Некорректный callback Quiz.');
        return;
      }

      if (parsed.action === 'cancel_start') {
        await ctx.answerCbQuery(quizStartCancelledText(lang));
        return;
      }

      if (parsed.action === 'start') {
        const freshSession = await getSession(userId);
        if (freshSession.state !== 'IDLE' && freshSession.state !== 'QUIZ_ACTIVE') {
          await resetState(userId);
        }
        await ctx.answerCbQuery();
        await startQuizFlow(ctx, userId, lang, freshSession);
        return;
      }

      if (parsed.action === 'answer' || parsed.action === 'skip') {
        const runId = parsed.runId;
        const questionId = parsed.questionId;
        const selectedOptionIndex = parsed.action === 'answer' ? parsed.selectedOptionIndex : null;

        if (!runId || !questionId || (parsed.action === 'answer' && selectedOptionIndex === null)) {
          await ctx.answerCbQuery(lang === 'uz' ? 'Quiz callback notogri.' : 'Некорректный callback Quiz.');
          return;
        }

        const run = await loadQuizRunSnapshot(userId, runId);
        if (!run) {
          await ctx.answerCbQuery(t(lang, 'session.lost'));
          return;
        }

        if (run.status !== 'ACTIVE') {
          clearScheduledQuizTimeout(runId);
          await resetState(userId);
          await sendQuizFinalReply(ctx, lang, toQuizSummaryFromRun(run), undefined, serviceMessage);
          await ctx.answerCbQuery();
          return;
        }

        const result = await submitAnswer(runId, questionId, selectedOptionIndex, null);
        if (!result.ok) {
          if (result.reason === 'RUN_NOT_ACTIVE') {
            const latest = await loadQuizRunSnapshot(userId, runId);
            if (latest) {
              clearScheduledQuizTimeout(runId);
              await resetState(userId);
              await sendQuizFinalReply(ctx, lang, toQuizSummaryFromRun(latest), undefined, serviceMessage);
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

        await handleAnsweredQuestion(ctx, userId, lang, runId, serviceMessage, result);
        return;
      }

      if (parsed.action === 'next') {
        const runId = parsed.runId;
        const run = await loadQuizRunSnapshot(userId, runId);
        if (!run) {
          await ctx.answerCbQuery(t(lang, 'session.lost'));
          return;
        }

        if (run.status !== 'ACTIVE') {
          clearScheduledQuizTimeout(runId);
          await resetState(userId);
          await sendQuizFinalReply(ctx, lang, toQuizSummaryFromRun(run), undefined, serviceMessage);
          await ctx.answerCbQuery();
          return;
        }

        if (run.currentIndex >= run.totalQuestions) {
          const summary = await finalizeCompletedRun(run);
          clearScheduledQuizTimeout(runId);
          await resetState(userId);
          await sendQuizFinalReply(ctx, lang, summary, undefined, serviceMessage);
          await ctx.answerCbQuery();
          return;
        }

        const question = await getCurrentQuestion(runId);
        if (!question) {
          await ctx.answerCbQuery(lang === 'uz' ? 'Savol topilmadi. Quizni qayta oching.' : 'Вопрос не найден. Откройте Quiz снова.');
          return;
        }

        const nextMessage = await upsertQuizQuestionFromContext(ctx, lang, question);
        if (nextMessage) {
          await rememberQuizQuestionState(userId, lang, runId, question, nextMessage, serviceMessage);
          scheduleQuizQuestionTimeout({
            userId,
            lang,
            runId,
            questionId: question.questionId,
            message: nextMessage,
          }, question.expiresAt);
        } else {
          await rememberQuizRunOnlyState(userId, lang, runId, serviceMessage);
        }
        await ctx.answerCbQuery();
        return;
      }

      if (parsed.action === 'exit') {
        const runId = parsed.runId;
        const run = await loadQuizRunSnapshot(userId, runId);
        if (!run) {
          await ctx.answerCbQuery(t(lang, 'session.lost'));
          return;
        }

        clearScheduledQuizTimeout(runId);
        await deleteQuizMessageByRef(parseQuizMessageRefFromPayload(session.payload));
        await deleteQuizMessageByRef(serviceMessage);
        const summary = await finishQuiz(runId);
        await resetState(userId);
        await sendQuizFinalReply(ctx, lang, summary ?? toQuizSummaryFromRun(run));
        await ctx.answerCbQuery(lang === 'uz' ? 'Quiz to‘xtatildi.' : 'Квиз остановлен.');
        return;
      }

      await ctx.answerCbQuery(lang === 'uz' ? 'Nomalum quiz action.' : 'Unknown quiz action.');
    } catch (error) {
      quizRuntimeLogger.error('quiz callback failed', { userId: userId.toString(), data, error });
      if (isQuizSchemaMissingError(error)) {
        await resetState(userId);
        await ctx.answerCbQuery(lang === 'uz' ? 'Quiz vaqtincha mavjud emas.' : 'Quiz временно недоступен.');
        await ctx.reply(quizUnavailableText(lang), { ...mainReplyKeyboard(lang) });
        return;
      }
      await ctx.answerCbQuery(quizCallbackErrorText(lang));
    }
  };

  return {
    handleQuizStart,
    handleQuizActiveText,
    handleQuizCallback,
    restoreActiveQuizTimeouts,
    runQuizQuestionTimeout,
  };
};
