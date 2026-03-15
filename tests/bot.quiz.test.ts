import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../src/generated/prisma';
import { prepareTestDatabase } from './helpers/testDb';
import { cleanupUserData } from './helpers/cleanup';

let bot: any;
let prisma: PrismaClient;
let startOrResumeQuiz: (userId: bigint) => Promise<any>;

const userId = 900000411;
const QUIZ_BUTTON = '\u{1F9E0} Quiz';

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
    .map(([, payload]: any[]) => String(payload?.text ?? ''));

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
  startOrResumeQuiz = quizService.startOrResumeQuiz;
  prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
});

beforeEach(async () => {
  await cleanupUserData(prisma, BigInt(userId));
  vi.restoreAllMocks();
});

afterAll(async () => {
  await cleanupUserData(prisma, BigInt(userId));
  await prisma.$disconnect();
});

describe('bot quiz integration', () => {
  it('starts quiz from keyboard button and enters QUIZ_ACTIVE', async () => {
    await seedQuizWords(8);
    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeMessageUpdate(QUIZ_BUTTON, 1), {} as any);

    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(session?.state).toBe('QUIZ_ACTIVE');
    expect(typeof (session?.payload as any)?.quizRunId).toBe('number');
    expect(sentTexts(callApiSpy).some((text) => text.includes('Quiz'))).toBe(true);
  });

  it('resumes existing active run and does not create duplicate runs', async () => {
    await seedQuizWords(8);
    const started = await startOrResumeQuiz(BigInt(userId));
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const callApiSpy = vi
      .spyOn(Object.getPrototypeOf(bot.telegram), 'callApi')
      .mockResolvedValue({} as any);

    await bot.handleUpdate(makeMessageUpdate(QUIZ_BUTTON, 2), {} as any);

    const runs = await prisma.quizRun.findMany({ where: { userId: BigInt(userId) } });
    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(runs.length).toBe(1);
    expect((session?.payload as any)?.quizRunId).toBe(started.runId);
    expect(sentTexts(callApiSpy).some((text) => text.includes('Quiz'))).toBe(true);
  });

  it('handles duplicate answer callback idempotently', async () => {
    await seedQuizWords(8);
    vi.spyOn(Object.getPrototypeOf(bot.telegram), 'callApi').mockResolvedValue({} as any);

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
    vi.spyOn(Object.getPrototypeOf(bot.telegram), 'callApi').mockResolvedValue({} as any);

    await bot.handleUpdate(makeMessageUpdate(QUIZ_BUTTON, 4), {} as any);
    const session = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    const runId = Number((session?.payload as any)?.quizRunId);
    expect(Number.isFinite(runId)).toBe(true);

    await bot.handleUpdate(makeCallbackUpdate(`quiz:exit:${runId}`, 41), {} as any);

    const run = await prisma.quizRun.findUnique({ where: { id: runId } });
    const sessionAfter = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(run?.status).toBe('ABANDONED');
    expect(sessionAfter?.state).toBe('IDLE');
  });

  it('completes full 10-question round via callbacks', async () => {
    await seedQuizWords(8);
    vi.spyOn(Object.getPrototypeOf(bot.telegram), 'callApi').mockResolvedValue({} as any);

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

      const afterAnswer = await prisma.quizRun.findUnique({ where: { id: runId } });
      if (afterAnswer?.status === 'ACTIVE') {
        await bot.handleUpdate(makeCallbackUpdate(`quiz:next:${runId}`, 101 + step * 2), {} as any);
      }
    }

    const finalRun = await prisma.quizRun.findUnique({ where: { id: runId } });
    const finalSession = await prisma.userSession.findUnique({ where: { userId: BigInt(userId) } });
    expect(finalRun?.status).toBe('COMPLETED');
    expect((finalRun?.correctCount ?? 0) + (finalRun?.wrongCount ?? 0) + (finalRun?.skippedCount ?? 0)).toBe(10);
    expect(finalSession?.state).toBe('IDLE');
  });
});
