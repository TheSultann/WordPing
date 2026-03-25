import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../src/generated/prisma';
import { prepareTestDatabase } from './helpers/testDb';
import { cleanupUserData } from './helpers/cleanup';

let prisma: PrismaClient;
let startOrResumeQuiz: (userId: bigint) => Promise<any>;
let getCurrentQuestion: (runId: number) => Promise<any>;
let submitAnswer: (runId: number, questionId: number, selectedOptionIndex: number | null, answerTimeMs?: number | null) => Promise<any>;
let finishQuiz: (runId: number) => Promise<any>;
let QUIZ_DAILY_LIMIT = 5;
let QUIZ_TIME_LIMIT_SECONDS = 12;
let QUIZ_TOTAL_QUESTIONS = 10;

const userId = BigInt(900000301);

const seedQuizWords = async (count = 8) => {
  await prisma.user.create({
    data: {
      id: userId,
      language: 'ru',
      timezone: 'UTC',
    },
  });

  for (let index = 1; index <= count; index += 1) {
    const word = await prisma.word.create({
      data: {
        userId,
        wordEn: `word-${index}`,
        translationRu: `native-${index}`,
        sentenceIndex: 0,
        exampleSentences: [
          {
            en: `I see word-${index} every day.`,
            native: `This is native-${index} sentence.`,
          },
        ] as any,
      },
    });

    await prisma.review.createMany({
      data: [
        {
          userId,
          wordId: word.id,
          direction: 'EN_TO_RU',
          stage: 3,
          intervalMinutes: 60,
          nextReviewAt: new Date(Date.now() - 1000),
        },
        {
          userId,
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
  const testUrl = await prepareTestDatabase();
  process.env.DATABASE_URL = testUrl;

  vi.resetModules();
  const quizService = await import('../src/services/quizService');
  startOrResumeQuiz = quizService.startOrResumeQuiz;
  getCurrentQuestion = quizService.getCurrentQuestion;
  submitAnswer = quizService.submitAnswer;
  finishQuiz = quizService.finishQuiz;
  QUIZ_DAILY_LIMIT = quizService.QUIZ_DAILY_LIMIT;
  QUIZ_TIME_LIMIT_SECONDS = quizService.QUIZ_TIME_LIMIT_SECONDS;
  QUIZ_TOTAL_QUESTIONS = quizService.QUIZ_TOTAL_QUESTIONS;

  prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
});

beforeEach(async () => {
  await cleanupUserData(prisma, userId);
});

afterAll(async () => {
  await cleanupUserData(prisma, userId);
  await prisma.$disconnect();
});

describe('quizService integration', () => {
  it('builds a quiz run without repeating the same word', async () => {
    await seedQuizWords(8);

    const started = await startOrResumeQuiz(userId);
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    expect(started.question).toBeTruthy();
    const run = await prisma.quizRun.findUnique({
      where: { id: started.runId },
      include: {
        items: {
          orderBy: { questionIndex: 'asc' },
        },
      },
    });

    expect(run).toBeTruthy();
    expect(run?.items.length).toBe(8);
    expect(run?.totalQuestions).toBe(8);

    const uniqueWordIds = new Set(run!.items.map((item) => item.wordId));
    expect(uniqueWordIds.size).toBe(run!.items.length);

    const directionCounts = run!.items.reduce<Record<string, number>>((acc, item) => {
      acc[item.direction] = (acc[item.direction] ?? 0) + 1;
      return acc;
    }, {});
    expect(directionCounts.EN_TO_RU ?? 0).toBeGreaterThan(0);
    expect(directionCounts.RU_TO_EN ?? 0).toBeGreaterThan(0);
    expect(Math.abs((directionCounts.EN_TO_RU ?? 0) - (directionCounts.RU_TO_EN ?? 0))).toBeLessThanOrEqual(1);

    const modeSet = new Set(run!.items.map((item) => item.mode));
    expect(modeSet.has('MULTIPLE_CHOICE')).toBe(true);
    expect(modeSet.has('TRUE_FALSE')).toBe(true);
    expect(modeSet.has('FILL_GAP')).toBe(true);

    for (const item of run!.items) {
      if (item.mode === 'TRUE_FALSE') {
        expect(item.options).toBeNull();
        expect([0, 1]).toContain(item.correctOptionIndex);
        expect(['TRUE', 'FALSE']).toContain(item.correctAnswer);
        continue;
      }

      const options = Array.isArray(item.options)
        ? item.options.filter((opt): opt is string => typeof opt === 'string')
        : [];
      expect(options.length).toBe(4);
      expect(new Set(options.map((opt) => opt.toLowerCase())).size).toBe(4);
      expect(options).toContain(item.correctAnswer);

      if (item.mode === 'FILL_GAP') {
        expect(item.promptText.includes('___')).toBe(false);
        expect(item.promptText.includes('<u><b>')).toBe(true);
      }
    }
  });

  it('resumes active run instead of creating a new one', async () => {
    await seedQuizWords(8);

    const first = await startOrResumeQuiz(userId);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await startOrResumeQuiz(userId);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.resumed).toBe(true);
    expect(second.runId).toBe(first.runId);

    const runCount = await prisma.quizRun.count({ where: { userId } });
    expect(runCount).toBe(1);
  });

  it('prioritizes overdue hard quiz words and cools down recently solved words', async () => {
    await seedQuizWords(12);

    const words = await prisma.word.findMany({
      where: { userId },
      select: { id: true, wordEn: true },
      orderBy: { id: 'asc' },
    });
    const focusWord = words.find((word) => word.wordEn === 'word-1');
    const cooledWord = words.find((word) => word.wordEn === 'word-12');

    expect(focusWord).toBeTruthy();
    expect(cooledWord).toBeTruthy();
    if (!focusWord || !cooledWord) return;

    await prisma.review.update({
      where: {
        wordId_direction: {
          wordId: focusWord.id,
          direction: 'EN_TO_RU',
        },
      },
      data: {
        stage: 4,
        intervalMinutes: 720,
        hardStreak: 2,
        lastResult: 'INCORRECT',
        lastReviewAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
        nextReviewAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      },
    });

    await prisma.review.update({
      where: {
        wordId_direction: {
          wordId: cooledWord.id,
          direction: 'EN_TO_RU',
        },
      },
      data: {
        stage: 3,
        intervalMinutes: 1440,
        hardStreak: 0,
        lastResult: 'CORRECT',
        lastReviewAt: new Date(),
        nextReviewAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    const previousRun = await prisma.quizRun.create({
      data: {
        userId,
        status: 'COMPLETED',
        totalQuestions: 1,
        currentIndex: 1,
        correctCount: 1,
        finishedAt: new Date(),
        durationSeconds: 10,
      },
    });

    const recentQuestionTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await prisma.quizRunItem.create({
      data: {
        runId: previousRun.id,
        questionIndex: 0,
        wordId: cooledWord.id,
        direction: 'EN_TO_RU',
        mode: 'MULTIPLE_CHOICE',
        promptText: cooledWord.wordEn,
        options: ['native-12', 'native-1', 'native-2', 'native-3'] as any,
        correctAnswer: 'native-12',
        correctOptionIndex: 0,
        selectedOptionIndex: 0,
        selectedAnswer: 'native-12',
        outcome: 'CORRECT',
        questionSentAt: recentQuestionTime,
        answeredAt: recentQuestionTime,
      },
    });

    const started = await startOrResumeQuiz(userId);
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const run = await prisma.quizRun.findUnique({
      where: { id: started.runId },
      select: {
        items: {
          select: {
            wordId: true,
            direction: true,
          },
        },
      },
    });

    const runWordIds = run?.items.map((item) => item.wordId) ?? [];

    expect(runWordIds).toContain(focusWord.id);
    expect(runWordIds).not.toContain(cooledWord.id);
  });

  it('emits selection debug payload when env flag is enabled', async () => {
    await seedQuizWords(8);

    process.env.QUIZ_SELECTION_DEBUG = '1';
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const started = await startOrResumeQuiz(userId);
      expect(started.ok).toBe(true);

      const debugCall = consoleSpy.mock.calls.find(([message]) => message === '[quiz][selection]');
      expect(debugCall).toBeTruthy();
      expect((debugCall?.[1] as any)?.label).toBe('ranking');
      expect(Array.isArray((debugCall?.[1] as any)?.selectedCandidates)).toBe(true);
      expect(Array.isArray((debugCall?.[1] as any)?.topCandidates)).toBe(true);
    } finally {
      delete process.env.QUIZ_SELECTION_DEBUG;
      consoleSpy.mockRestore();
    }
  });

  it('shrinks the quiz instead of repeating words when the pool is small', async () => {
    await seedQuizWords(4);

    const started = await startOrResumeQuiz(userId);
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const run = await prisma.quizRun.findUnique({
      where: { id: started.runId },
      include: {
        items: {
          orderBy: { questionIndex: 'asc' },
        },
      },
    });

    expect(run).toBeTruthy();
    expect(run?.items.length).toBe(4);
    expect(run?.totalQuestions).toBe(4);
    expect(new Set(run!.items.map((item) => item.wordId)).size).toBe(4);
  });

  it('marks timeout as SKIPPED', async () => {
    await seedQuizWords(8);

    const started = await startOrResumeQuiz(userId);
    expect(started.ok).toBe(true);
    if (!started.ok || !started.question) return;

    await prisma.quizRunItem.update({
      where: { id: started.question.questionId },
      data: {
        questionSentAt: new Date(Date.now() - (QUIZ_TIME_LIMIT_SECONDS + 1) * 1000),
      },
    });

    const result = await submitAnswer(started.runId, started.question.questionId, 0, 20_000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.outcome).toBe('SKIPPED');
    expect(result.timedOut).toBe(true);

    const run = await prisma.quizRun.findUnique({ where: { id: started.runId } });
    expect(run?.skippedCount).toBe(1);
  });

  it('enforces daily starts limit', async () => {
    await seedQuizWords(8);

    for (let index = 0; index < QUIZ_DAILY_LIMIT; index += 1) {
      const started = await startOrResumeQuiz(userId);
      expect(started.ok).toBe(true);
      if (started.ok) {
        await finishQuiz(started.runId);
      }
    }

    const denied = await startOrResumeQuiz(userId);
    expect(denied.ok).toBe(false);
    if (denied.ok) return;

    expect(denied.reason).toBe('LIMIT_REACHED');
    expect(denied.usedToday).toBe(QUIZ_DAILY_LIMIT);
  });

  it('finishes round and returns consistent summary counters', async () => {
    await seedQuizWords(8);

    const started = await startOrResumeQuiz(userId);
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    let lastResult: any = null;
    for (let index = 0; index < QUIZ_TOTAL_QUESTIONS; index += 1) {
      const current = await getCurrentQuestion(started.runId);
      if (!current) break;

      const item = await prisma.quizRunItem.findUnique({
        where: { id: current.questionId },
        select: { correctOptionIndex: true, options: true },
      });

      let answer: number | null = null;
      if (index % 3 === 0) {
        answer = item?.correctOptionIndex ?? 0;
      } else if (index % 3 === 1) {
        const optionCount = Array.isArray(item?.options) ? item!.options.length : 2;
        if (item?.correctOptionIndex !== null && item?.correctOptionIndex !== undefined && optionCount > 1) {
          answer = (item.correctOptionIndex + 1) % optionCount;
        } else {
          answer = null;
        }
      } else {
        answer = null;
      }

      const result = await submitAnswer(started.runId, current.questionId, answer, 500);
      expect(result.ok).toBe(true);
      if (!result.ok) break;
      lastResult = result;
    }

    expect(lastResult).toBeTruthy();
    expect(lastResult?.summary?.status).toBe('COMPLETED');
    expect(lastResult?.summary?.totalQuestions).toBe(8);
    expect(
      (lastResult?.summary?.correctCount ?? 0) +
      (lastResult?.summary?.wrongCount ?? 0) +
      (lastResult?.summary?.skippedCount ?? 0),
    ).toBe(8);
  });
});
