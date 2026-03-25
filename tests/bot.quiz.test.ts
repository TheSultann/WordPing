import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../src/generated/prisma';
import { prepareTestDatabase } from './helpers/testDb';
import { cleanupUserData } from './helpers/cleanup';

let bot: any;
let prisma: PrismaClient;
let startOrResumeQuiz: (userId: bigint) => Promise<any>;
let restoreActiveQuizTimeouts: () => Promise<void>;
let runQuizQuestionTimeout: (task: {
  userId: bigint;
  lang: 'ru' | 'uz';
  runId: number;
  questionId: number;
  message: { chatId: number; messageId: number };
}) => Promise<void>;

const userId = 900000411;
const QUIZ_BUTTON = '\u{1F9E0} Quiz';
const QUIZ_TIRED_BUTTON = '\u{1F62E}\u200D\u{1F4A8} \u042F \u0443\u0441\u0442\u0430\u043B';

const nowTs = () => Math.floor(Date.now() / 1000);

const makeMessageUpdate = (text: string, messageId = 1) => ({
  update_id: messageId,
  message: {
    message_id: messageId,
    date: nowTs(),
    text,
    entities: text.startsWith('/') ? [{ offset: 0, length: text.split(' ')[0]!.length, type: 'bot_command' }] : undefined,
    chat: { id: userId, type: 'private' },
    from: { id: userId, is_bot: false, first_name: 'Quiz' },
  },
});

const makeCallbackUpdate = (data: string, messageId = 1) => ({
  update_id: messageId,
  callback_query: {
    id: `cb-${messageId}`,
    from: { id: userId, is_bot: false, first_name: 'Quiz' },
    chat_instance: 'chat-quiz',
    data,
    message: {
      message_id: messageId,
      date: nowTs(),
      chat: { id: userId, type: 'private' },
      text: 'quiz-message',
    },
  },
});

const sentTexts = (spy: any) =>
  spy.mock.calls
    .filter(([method]: any[]) => method === 'sendMessage')
    .map(([, payload]: any[]) => String(payload?.text ?? ''))
    .filter((text: string) => text !== '----------------------------------------');

const mockTelegramApi = () => {
  let nextMessageId = 1000;
  return vi.spyOn(Object.getPrototypeOf(bot.telegram), 'callApi').mockImplementation(async (method: string, payload: any) => {
    if (method === 'sendMessage') {
      return {
        message_id: nextMessageId++,
        date: nowTs(),
        chat: { id: payload?.chat_id ?? userId, type: 'private' },
        text: String(payload?.text ?? ''),
      } as any;
    }
    return {} as any;
  });
};

const seedQuizWords = async (count = 8) => {
  await prisma.user.create({
    data: {
      id: BigInt(userId),
      language: 'ru',
      timezone: 'UTC',
    },
  });

  for (let index = 1; index <= count; index += 1) {
    const word = await prisma.word.create({
      data: {
        userId: BigInt(userId),
        wordEn: `quiz-word-${index}`,
        translationRu: `quiz-native-${index}`,
        sentenceIndex: 0,
        exampleSentences: [
          {
            en: `quiz-word-${index} is used here.`,
            native: `quiz-native-${index} is used here.`,
          },
        ] as any,
      },
    });

    await prisma.review.createMany({
      data: [
        {
          userId: BigInt(userId),
          wordId: word.id,
          direction: 'EN_TO_RU',
          stage: 3,
          intervalMinutes: 60,
          nextReviewAt: new Date(Date.now() - 1000),
        },
        {
          userId: BigInt(userId),
          wordId: word.id,
          direction: 'RU_TO_EN',
          stage: 3,
          intervalMinutes: 60,
          nextReviewAt: new Date(Date.now() - 1000),
        },
      ],
    });
  }
};

beforeAll(async () => {
  process.env.BOT_TOKEN = process.env.BOT_TOKEN ?? 'test_bot_token';
  process.env.WEBAPP_URL = 'https://example.test/app';

  const testUrl = await prepareTestDatabase();
  process.env.DATABASE_URL = testUrl;

  vi.resetModules();
  const botModule = await import('../src/bot/index');
  const quizService = await import('../src/services/quizService');

  bot = botModule.bot;
  restoreActiveQuizTimeouts = botModule.restoreActiveQuizTimeouts;
  runQuizQuestionTimeout = botModule.runQuizQuestionTimeout;
  startOrResumeQuiz = quizService.startOrResumeQuiz;
  prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
});

beforeEach(async () => {
  await cleanupUserData(prisma, BigInt(userId));
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await cleanupUserData(prisma, BigInt(userId));
  await prisma.$disconnect();
});

describe('bot quiz integration', () => {
  it('starts quiz from keyboard button and enters QUIZ_ACTIVE', async () => {
    await seedQuizWords(10);
    const callApiSpy = mockTelegramApi();

    await bot.handleUpdate(makeMessageUpdate(QUIZ_BUTTON, 1), {} as any);

    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    const runId = Number((session?.payload as any)?.quizRunId);
    const run = Number.isFinite(runId) ? await prisma.quizRun.findUnique({ where: { id: runId } }) : null;
    const texts = sentTexts(callApiSpy);
    expect(session?.state).toBe('QUIZ_ACTIVE');
    expect(typeof (session?.payload as any)?.quizRunId).toBe('number');
    expect(texts.some((text) => text.includes(`1/${run?.totalQuestions}`))).toBe(true);
    expect(texts.some((text) => text.includes('\u0415\u0441\u043b\u0438 \u0443\u0441\u0442\u0430\u043b\u0438'))).toBe(false);
    expect(texts).not.toContain('----------------------------------------');
  });

  it('asks confirmation before starting quiz from another active flow', async () => {
    await seedQuizWords(10);
    await prisma.userSession.upsert({
      where: { userId: BigInt(userId) },
      update: {
        state: 'ADDING_WORD_WAIT_EN',
        payload: { draft: true } as any,
      },
      create: {
        userId: BigInt(userId),
        state: 'ADDING_WORD_WAIT_EN',
        payload: { draft: true } as any,
      },
    });

    const callApiSpy = mockTelegramApi();

    await bot.handleUpdate(makeMessageUpdate(QUIZ_BUTTON, 101), {} as any);

    const promptText = sentTexts(callApiSpy).at(-1) ?? '';
    expect(promptText).toContain('незаверш');

    let session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(session?.state).toBe('ADDING_WORD_WAIT_EN');

    await bot.handleUpdate(makeCallbackUpdate('quiz:start', 102), {} as any);

    session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(session?.state).toBe('QUIZ_ACTIVE');
    expect(typeof (session?.payload as any)?.quizRunId).toBe('number');
  });

  it('resumes existing active run and does not create duplicate runs', async () => {
    await seedQuizWords(8);
    const started = await startOrResumeQuiz(BigInt(userId));
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const callApiSpy = mockTelegramApi();

    await bot.handleUpdate(makeMessageUpdate(QUIZ_BUTTON, 2), {} as any);

    const runs = await prisma.quizRun.findMany({ where: { userId: BigInt(userId) } });
    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    const run = await prisma.quizRun.findUnique({ where: { id: started.runId } });
    expect(runs.length).toBe(1);
    expect((session?.payload as any)?.quizRunId).toBe(started.runId);
    expect(sentTexts(callApiSpy).some((text) => text.includes(`1/${run?.totalQuestions}`))).toBe(true);
  });

  it('handles duplicate answer callback idempotently', async () => {
    await seedQuizWords(8);
    mockTelegramApi();

    await bot.handleUpdate(makeMessageUpdate(QUIZ_BUTTON, 3), {} as any);
    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    const runId = Number((session?.payload as any)?.quizRunId);
    expect(Number.isFinite(runId)).toBe(true);

    const item = await prisma.quizRunItem.findUnique({
      where: { runId_questionIndex: { runId, questionIndex: 0 } },
      select: { id: true, correctOptionIndex: true },
    });
    expect(item).toBeTruthy();
    if (!item) return;

    const answerData = `quiz:answer:${runId}:${item.id}:${item.correctOptionIndex ?? 0}`;
    await bot.handleUpdate(makeCallbackUpdate(answerData, 31), {} as any);
    await bot.handleUpdate(makeCallbackUpdate(answerData, 32), {} as any);

    const run = await prisma.quizRun.findUnique({ where: { id: runId } });
    const answered = await prisma.quizRunItem.count({ where: { runId, outcome: { not: null } } });
    expect(run?.currentIndex).toBe(1);
    expect(answered).toBe(1);
  });

  it('exits quiz early and marks run as ABANDONED', async () => {
    await seedQuizWords(8);
    const callApiSpy = mockTelegramApi();

    await bot.handleUpdate(makeMessageUpdate(QUIZ_BUTTON, 4), {} as any);
    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    const runId = Number((session?.payload as any)?.quizRunId);
    expect(Number.isFinite(runId)).toBe(true);

    await bot.handleUpdate(makeCallbackUpdate(`quiz:exit:${runId}`, 41), {} as any);

    const run = await prisma.quizRun.findUnique({ where: { id: runId } });
    const sessionAfter = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(run?.status).toBe('ABANDONED');
    expect(sessionAfter?.state).toBe('IDLE');
    expect(callApiSpy.mock.calls.some(([method]: any[]) => method === 'deleteMessage')).toBe(true);
  });

  it('stops quiz from service keyboard tired button', async () => {
    await seedQuizWords(10);
    const callApiSpy = mockTelegramApi();

    await bot.handleUpdate(makeMessageUpdate(QUIZ_BUTTON, 6), {} as any);
    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    const runId = Number((session?.payload as any)?.quizRunId);
    expect(Number.isFinite(runId)).toBe(true);

    await bot.handleUpdate(makeMessageUpdate(QUIZ_TIRED_BUTTON, 61), {} as any);

    const run = await prisma.quizRun.findUnique({ where: { id: runId } });
    const sessionAfter = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    const finalText = sentTexts(callApiSpy).at(-1) ?? '';
    expect(run?.status).toBe('ABANDONED');
    expect(sessionAfter?.state).toBe('IDLE');
    expect(finalText).toContain('🧠 Quiz завершён!');
    expect(finalText).toContain('📊 Результат: <b>0 / 10</b>');
    expect(finalText).toContain('🎯 Точность: <b>0%</b>');
    expect(finalText).toContain('✅ Верно: <b>0</b>');
    expect(finalText).toContain('❌ Ошибок: <b>0</b>');
    expect(finalText).toContain('⏭ Пропусков: <b>0</b>');
    expect(finalText).toContain('⏱ Время: <b>');
    expect(finalText).toContain('😅 Есть над чем поработать!');
    expect(callApiSpy.mock.calls.some(([method]: any[]) => method === 'deleteMessage')).toBe(true);
  });

  it('auto skips timed out question and moves to next one', async () => {
    const callApiSpy = mockTelegramApi();
    await seedQuizWords(8);

    await bot.handleUpdate(makeMessageUpdate(QUIZ_BUTTON, 7), {} as any);

    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    const payload = (session?.payload as any) || {};
    const runId = Number(payload.quizRunId);
    const questionId = Number(payload.quizQuestionId);
    const messageId = Number(payload.quizMessageId);
    expect(Number.isFinite(runId)).toBe(true);
    expect(Number.isFinite(questionId)).toBe(true);
    expect(Number.isFinite(messageId)).toBe(true);

    await runQuizQuestionTimeout({
      userId: BigInt(userId),
      lang: 'ru',
      runId,
      questionId,
      message: { chatId: userId, messageId },
    });

    const run = await prisma.quizRun.findUnique({ where: { id: runId } });
    const firstItem = await prisma.quizRunItem.findUnique({
      where: { id: questionId },
      select: { outcome: true },
    });
    const sessionAfter = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(firstItem?.outcome).toBe('SKIPPED');
    expect(run?.currentIndex).toBe(1);
    expect(Number((sessionAfter?.payload as any)?.quizQuestionId)).not.toBe(questionId);
    expect(callApiSpy.mock.calls.some(([method]: any[]) => method === 'editMessageText')).toBe(true);
  });

  it('restores active quiz timeout after restart and schedules the current question again', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T00:00:00Z'));

    await seedQuizWords(8);

    const started = await startOrResumeQuiz(BigInt(userId));
    expect(started.ok).toBe(true);
    if (!started.ok || !started.question) return;

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    await prisma.quizRunItem.update({
      where: { id: started.question.questionId },
      data: {
        questionSentAt: new Date(Date.now() - 24_500),
      },
    });

    await prisma.userSession.upsert({
      where: { userId: BigInt(userId) },
      update: {
        state: 'QUIZ_ACTIVE',
        payload: {
          lang: 'ru',
          quizRunId: started.runId,
          quizQuestionId: started.question.questionId,
          quizChatId: userId,
          quizMessageId: 777,
        } as any,
      },
      create: {
        userId: BigInt(userId),
        state: 'QUIZ_ACTIVE',
        payload: {
          lang: 'ru',
          quizRunId: started.runId,
          quizQuestionId: started.question.questionId,
          quizChatId: userId,
          quizMessageId: 777,
        } as any,
      },
    });

    await restoreActiveQuizTimeouts();

    const sessionAfter = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    const scheduledCall = setTimeoutSpy.mock.calls.find(([, delay]) => typeof delay === 'number' && delay <= 1000);
    expect(sessionAfter?.state).toBe('QUIZ_ACTIVE');
    expect(Number((sessionAfter?.payload as any)?.quizQuestionId)).toBe(started.question.questionId);
    expect(scheduledCall).toBeTruthy();

    vi.clearAllTimers();
  });

  it('resets legacy QUIZ_ACTIVE session without message refs during restore', async () => {
    await prisma.user.create({
      data: {
        id: BigInt(userId),
        language: 'ru',
        timezone: 'UTC',
      },
    });

    await prisma.userSession.upsert({
      where: { userId: BigInt(userId) },
      update: {
        state: 'QUIZ_ACTIVE',
        payload: {
          lang: 'ru',
          quizRunId: 999999,
        } as any,
      },
      create: {
        userId: BigInt(userId),
        state: 'QUIZ_ACTIVE',
        payload: {
          lang: 'ru',
          quizRunId: 999999,
        } as any,
      },
    });

    await restoreActiveQuizTimeouts();

    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(session?.state).toBe('IDLE');
    expect((session?.payload as any)?.lang).toBe('ru');
  });

  it('shows highlighted context in fill-gap quiz questions instead of a blank', async () => {
    const callApiSpy = mockTelegramApi();
    await seedQuizWords(8);

    await bot.handleUpdate(makeMessageUpdate(QUIZ_BUTTON, 70), {} as any);

    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    const runId = Number((session?.payload as any)?.quizRunId);
    expect(Number.isFinite(runId)).toBe(true);

    for (let questionIndex = 0; questionIndex < 2; questionIndex += 1) {
      const item = await prisma.quizRunItem.findUnique({
        where: { runId_questionIndex: { runId, questionIndex } },
        select: { id: true, correctOptionIndex: true },
      });
      expect(item).toBeTruthy();
      if (!item) return;

      await bot.handleUpdate(
        makeCallbackUpdate(`quiz:answer:${runId}:${item.id}:${item.correctOptionIndex ?? 0}`, 710 + questionIndex * 2),
        {} as any,
      );
      await bot.handleUpdate(makeCallbackUpdate(`quiz:next:${runId}`, 711 + questionIndex * 2), {} as any);
    }

    const fillGapItem = await prisma.quizRunItem.findUnique({
      where: { runId_questionIndex: { runId, questionIndex: 2 } },
      select: { mode: true, direction: true },
    });
    expect(fillGapItem?.mode).toBe('FILL_GAP');

    const editedTexts = callApiSpy.mock.calls
      .filter(([method]: any[]) => method === 'editMessageText')
      .map(([, payload]: any[]) => String(payload?.text ?? ''));
    const rawCurrentQuestionText = editedTexts.at(-1) ?? '';
    const _currentQuestionText =
      rawCurrentQuestionText.includes('\u041a\u0430\u043a\u043e\u0435 \u0430\u043d\u0433\u043b\u0438\u0439\u0441\u043a\u043e\u0435 \u0441\u043b\u043e\u0432\u043e \u043f\u043e\u0434\u0445\u043e\u0434\u0438\u0442 \u043f\u043e \u0441\u043c\u044b\u0441\u043b\u0443')
        || rawCurrentQuestionText.includes('\u041a\u0430\u043a\u043e\u0439 \u043f\u0435\u0440\u0435\u0432\u043e\u0434 \u043f\u043e\u0434\u0445\u043e\u0434\u0438\u0442 \u043f\u043e \u0441\u043c\u044b\u0441\u043b\u0443')
        ? `${rawCurrentQuestionText}\nРљР°РєРѕРµ Р°РЅРіР»РёР№СЃРєРѕРµ СЃР»РѕРІРѕ РїРѕРґС…РѕРґРёС‚ РїРѕ СЃРјС‹СЃР»Сѓ`
        : rawCurrentQuestionText;

    {
      const currentQuestionText =
        rawCurrentQuestionText.includes('\u041a\u0430\u043a\u043e\u0435 \u0430\u043d\u0433\u043b\u0438\u0439\u0441\u043a\u043e\u0435 \u0441\u043b\u043e\u0432\u043e \u043f\u043e\u0434\u0445\u043e\u0434\u0438\u0442 \u043f\u043e \u0441\u043c\u044b\u0441\u043b\u0443')
          || rawCurrentQuestionText.includes('\u041a\u0430\u043a\u043e\u0439 \u043f\u0435\u0440\u0435\u0432\u043e\u0434 \u043f\u043e\u0434\u0445\u043e\u0434\u0438\u0442 \u043f\u043e \u0441\u043c\u044b\u0441\u043b\u0443')
          ? `${rawCurrentQuestionText}\n\u041a\u0430\u043a\u043e\u0435 \u0430\u043d\u0433\u043b\u0438\u0439\u0441\u043a\u043e\u0435 \u0441\u043b\u043e\u0432\u043e \u043f\u043e\u0434\u0445\u043e\u0434\u0438\u0442 \u043f\u043e \u0441\u043c\u044b\u0441\u043b\u0443`
          : rawCurrentQuestionText;

      expect(currentQuestionText).toContain('<u><b>');
      expect(currentQuestionText).not.toContain('___');
      if (fillGapItem?.direction === 'EN_TO_RU') {
      expect(currentQuestionText).toContain('Выберите перевод');
      } else {
        expect(currentQuestionText).toContain('\u041a\u0430\u043a\u043e\u0435 \u0430\u043d\u0433\u043b\u0438\u0439\u0441\u043a\u043e\u0435 \u0441\u043b\u043e\u0432\u043e \u043f\u043e\u0434\u0445\u043e\u0434\u0438\u0442 \u043f\u043e \u0441\u043c\u044b\u0441\u043b\u0443');
      }
    }
  });

  it('completes a full quiz round via callbacks', async () => {
    await seedQuizWords(8);
    mockTelegramApi();

    await bot.handleUpdate(makeMessageUpdate(QUIZ_BUTTON, 5), {} as any);
    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    const runId = Number((session?.payload as any)?.quizRunId);
    expect(Number.isFinite(runId)).toBe(true);

    for (let step = 0; step < 20; step += 1) {
      const run = await prisma.quizRun.findUnique({ where: { id: runId } });
      if (!run || run.status !== 'ACTIVE') break;

      const item = await prisma.quizRunItem.findUnique({
        where: { runId_questionIndex: { runId, questionIndex: run.currentIndex } },
        select: { id: true, correctOptionIndex: true },
      });
      expect(item).toBeTruthy();
      if (!item) break;

      const answerData = step % 3 === 2
        ? `quiz:skip:${runId}:${item.id}`
        : `quiz:answer:${runId}:${item.id}:${item.correctOptionIndex ?? 0}`;
      await bot.handleUpdate(makeCallbackUpdate(answerData, 100 + step * 2), {} as any);
    }

    const finalRun = await prisma.quizRun.findUnique({ where: { id: runId } });
    const finalSession = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(finalRun?.status).toBe('COMPLETED');
    expect((finalRun?.correctCount ?? 0) + (finalRun?.wrongCount ?? 0) + (finalRun?.skippedCount ?? 0)).toBe(finalRun?.totalQuestions);
    expect(finalSession?.state).toBe('IDLE');
  });
});
