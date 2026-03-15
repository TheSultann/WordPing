import { CardDirection, Prisma, QuizAnswerOutcome, QuizQuestionMode, QuizRunStatus } from '../generated/prisma/client';
import { prisma } from '../db/client';
import { toExampleSentenceArray } from './sentenceService';
import { blankTargetInSentence } from '../utils/reviewCardText';
import { nowUtc, startOfUserDay } from '../utils/time';

export const QUIZ_DAILY_LIMIT = 5;
export const QUIZ_TOTAL_QUESTIONS = 10;
export const QUIZ_TIME_LIMIT_SECONDS = 12;

const QUIZ_MODES: readonly QuizQuestionMode[] = ['MULTIPLE_CHOICE', 'TRUE_FALSE', 'FILL_GAP'];
const QUIZ_DIRECTIONS: readonly CardDirection[] = ['EN_TO_RU', 'RU_TO_EN'];

type QuizWordCandidate = {
  wordId: number;
  wordEn: string;
  translationRu: string;
  sentenceIndex: number;
  exampleSentences: Prisma.JsonValue | null;
  direction: CardDirection;
};

type RawQuestion = {
  questionIndex: number;
  wordId: number;
  direction: CardDirection;
  mode: QuizQuestionMode;
  promptText: string;
  options: string[] | null;
  correctAnswer: string;
  correctOptionIndex: number;
};

export type QuizQuestionView = {
  runId: number;
  questionId: number;
  questionIndex: number;
  totalQuestions: number;
  direction: CardDirection;
  mode: QuizQuestionMode;
  promptText: string;
  options: string[] | null;
  expiresAt: Date;
};

export type QuizSummary = {
  runId: number;
  status: QuizRunStatus;
  totalQuestions: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  accuracyPercent: number;
  durationSeconds: number | null;
};

export type StartOrResumeQuizResult =
  | {
      ok: true;
      resumed: boolean;
      runId: number;
      question: QuizQuestionView | null;
      summary: QuizSummary | null;
    }
  | {
      ok: false;
      reason: 'LIMIT_REACHED' | 'INSUFFICIENT_WORDS';
      limit: number;
      usedToday: number;
      minRequiredWords?: number;
    };

export type SubmitQuizAnswerResult =
  | {
      ok: true;
      duplicate: boolean;
      stale: boolean;
      runId: number;
      questionId: number;
      outcome: QuizAnswerOutcome;
      correctAnswer: string;
      selectedAnswer: string | null;
      timedOut: boolean;
      summary: QuizSummary | null;
      nextQuestion: QuizQuestionView | null;
    }
  | {
      ok: false;
      reason: 'RUN_NOT_FOUND' | 'QUESTION_NOT_FOUND' | 'RUN_NOT_ACTIVE';
    };

const shuffle = <T>(items: readonly T[]): T[] => {
  const arr = [...items];
  for (let index = arr.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = arr[index];
    arr[index] = arr[swapIndex] as T;
    arr[swapIndex] = current as T;
  }
  return arr;
};

const uniqueStrings = (items: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const normalized = item.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(item.trim());
  }
  return out;
};

const clampAnswerTimeMs = (value: number | null | undefined): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.max(0, Math.min(60_000, Math.round(value)));
};

const parseOptions = (value: Prisma.JsonValue | null): string[] | null => {
  if (!Array.isArray(value)) return null;
  const options = value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
  return options.length > 0 ? options : null;
};

const calculateAccuracyPercent = (correctCount: number, totalQuestions: number): number => {
  if (!Number.isFinite(totalQuestions) || totalQuestions <= 0) return 0;
  return Math.round((Math.max(0, correctCount) / totalQuestions) * 100);
};

const toQuizSummary = (run: {
  id: number;
  status: QuizRunStatus;
  totalQuestions: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  durationSeconds: number | null;
}): QuizSummary => ({
  runId: run.id,
  status: run.status,
  totalQuestions: run.totalQuestions,
  correctCount: run.correctCount,
  wrongCount: run.wrongCount,
  skippedCount: run.skippedCount,
  accuracyPercent: calculateAccuracyPercent(run.correctCount, run.totalQuestions),
  durationSeconds: run.durationSeconds,
});

const buildDirectionSequence = (): CardDirection[] => {
  const perDirection = Math.floor(QUIZ_TOTAL_QUESTIONS / QUIZ_DIRECTIONS.length);
  const sequence: CardDirection[] = [];
  for (const direction of QUIZ_DIRECTIONS) {
    for (let index = 0; index < perDirection; index += 1) {
      sequence.push(direction);
    }
  }
  while (sequence.length < QUIZ_TOTAL_QUESTIONS) {
    sequence.push(QUIZ_DIRECTIONS[sequence.length % QUIZ_DIRECTIONS.length] ?? 'EN_TO_RU');
  }
  return shuffle(sequence);
};

const buildModeSequence = (): QuizQuestionMode[] => {
  const modes: QuizQuestionMode[] = [];
  for (let index = 0; index < QUIZ_TOTAL_QUESTIONS; index += 1) {
    modes.push(QUIZ_MODES[index % QUIZ_MODES.length] ?? 'MULTIPLE_CHOICE');
  }
  return modes;
};

const drawDistractors = (pool: string[], correctAnswer: string, count: number): string[] => {
  const correctNorm = correctAnswer.trim().toLowerCase();
  const filtered = pool.filter((item) => item.trim().toLowerCase() !== correctNorm);
  return shuffle(filtered).slice(0, count);
};

const buildFillGapPrompt = (candidate: QuizWordCandidate): string | null => {
  const examples = toExampleSentenceArray(candidate.exampleSentences);
  if (!examples.length) return null;
  const sentence = examples[candidate.sentenceIndex % examples.length] ?? examples[0];
  if (!sentence) return null;

  if (candidate.direction === 'EN_TO_RU') {
    return blankTargetInSentence(sentence.en, candidate.wordEn);
  }
  return blankTargetInSentence(sentence.native, candidate.translationRu);
};

const buildMultipleChoiceQuestion = (
  questionIndex: number,
  candidate: QuizWordCandidate,
  answerPool: string[],
  mode: QuizQuestionMode,
): RawQuestion | null => {
  const correctAnswer = candidate.direction === 'EN_TO_RU' ? candidate.translationRu : candidate.wordEn;
  const distractors = drawDistractors(answerPool, correctAnswer, 3);
  if (distractors.length < 3) return null;
  const options = shuffle([correctAnswer, ...distractors]);
  const correctOptionIndex = options.findIndex((item) => item === correctAnswer);
  if (correctOptionIndex < 0) return null;

  let promptText = candidate.direction === 'EN_TO_RU' ? candidate.wordEn : candidate.translationRu;
  let effectiveMode: QuizQuestionMode = mode;
  if (mode === 'FILL_GAP') {
    const gapPrompt = buildFillGapPrompt(candidate);
    if (gapPrompt) {
      promptText = gapPrompt;
    } else {
      // Fallback when example sentences are missing for this word.
      effectiveMode = 'MULTIPLE_CHOICE';
    }
  }

  return {
    questionIndex,
    wordId: candidate.wordId,
    direction: candidate.direction,
    mode: effectiveMode,
    promptText,
    options,
    correctAnswer,
    correctOptionIndex,
  };
};

const buildTrueFalseQuestion = (
  questionIndex: number,
  candidate: QuizWordCandidate,
  answerPool: string[],
): RawQuestion | null => {
  const correctAnswer = candidate.direction === 'EN_TO_RU' ? candidate.translationRu : candidate.wordEn;
  const falseCandidate = drawDistractors(answerPool, correctAnswer, 1)[0];
  if (!falseCandidate) return null;

  const statementIsTrue = Math.random() >= 0.5;
  const rightSide = statementIsTrue ? correctAnswer : falseCandidate;
  const leftSide = candidate.direction === 'EN_TO_RU' ? candidate.wordEn : candidate.translationRu;
  const promptText = `${leftSide} - ${rightSide}`;

  return {
    questionIndex,
    wordId: candidate.wordId,
    direction: candidate.direction,
    mode: 'TRUE_FALSE',
    promptText,
    options: null,
    correctAnswer: statementIsTrue ? 'TRUE' : 'FALSE',
    correctOptionIndex: statementIsTrue ? 0 : 1,
  };
};

const buildQuestionSet = (candidates: QuizWordCandidate[]): RawQuestion[] => {
  const byDirection: Record<CardDirection, QuizWordCandidate[]> = {
    EN_TO_RU: shuffle(candidates.filter((item) => item.direction === 'EN_TO_RU')),
    RU_TO_EN: shuffle(candidates.filter((item) => item.direction === 'RU_TO_EN')),
  };

  const nativeAnswerPool = uniqueStrings(
    candidates
      .filter((item) => item.direction === 'EN_TO_RU')
      .map((item) => item.translationRu),
  );
  const englishAnswerPool = uniqueStrings(
    candidates
      .filter((item) => item.direction === 'RU_TO_EN')
      .map((item) => item.wordEn),
  );

  if (nativeAnswerPool.length < 4 || englishAnswerPool.length < 4) return [];
  if (!byDirection.EN_TO_RU.length || !byDirection.RU_TO_EN.length) return [];

  const directionSequence = buildDirectionSequence();
  const modeSequence = buildModeSequence();
  const pointers: Record<CardDirection, number> = { EN_TO_RU: 0, RU_TO_EN: 0 };
  const out: RawQuestion[] = [];

  for (let index = 0; index < QUIZ_TOTAL_QUESTIONS; index += 1) {
    const direction = directionSequence[index] ?? 'EN_TO_RU';
    const mode = modeSequence[index] ?? 'MULTIPLE_CHOICE';
    const pool = byDirection[direction];
    if (!pool.length) return [];

    const pointer = pointers[direction] % pool.length;
    pointers[direction] += 1;
    const candidate = pool[pointer] ?? pool[0];
    if (!candidate) return [];

    const answerPool = direction === 'EN_TO_RU' ? nativeAnswerPool : englishAnswerPool;
    const question =
      mode === 'TRUE_FALSE'
        ? buildTrueFalseQuestion(index, candidate, answerPool)
        : buildMultipleChoiceQuestion(index, candidate, answerPool, mode);

    if (!question) return [];
    out.push(question);
  }

  return out;
};

const getUserDayStart = async (userId: bigint, date = nowUtc().toDate()): Promise<Date> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  return startOfUserDay(user?.timezone, nowUtc()).toDate();
};

const buildQuestionView = (
  run: { id: number; totalQuestions: number; currentIndex: number; status: QuizRunStatus },
  item: {
    id: number;
    questionIndex: number;
    direction: CardDirection;
    mode: QuizQuestionMode;
    promptText: string;
    options: Prisma.JsonValue | null;
    questionSentAt: Date | null;
  },
): QuizQuestionView => {
  const sentAt = item.questionSentAt ?? new Date();
  return {
    runId: run.id,
    questionId: item.id,
    questionIndex: item.questionIndex,
    totalQuestions: run.totalQuestions,
    direction: item.direction,
    mode: item.mode,
    promptText: item.promptText,
    options: parseOptions(item.options),
    expiresAt: new Date(sentAt.getTime() + QUIZ_TIME_LIMIT_SECONDS * 1000),
  };
};

const loadQuizQuestion = async (runId: number): Promise<QuizQuestionView | null> => {
  const run = await prisma.quizRun.findUnique({
    where: { id: runId },
    select: { id: true, totalQuestions: true, currentIndex: true, status: true },
  });
  if (!run || run.status !== 'ACTIVE') return null;
  if (run.currentIndex >= run.totalQuestions) return null;

  const item = await prisma.quizRunItem.findUnique({
    where: { runId_questionIndex: { runId, questionIndex: run.currentIndex } },
    select: {
      id: true,
      questionIndex: true,
      direction: true,
      mode: true,
      promptText: true,
      options: true,
      questionSentAt: true,
    },
  });
  if (!item) return null;

  if (!item.questionSentAt) {
    const now = new Date();
    await prisma.quizRunItem.update({
      where: { id: item.id },
      data: { questionSentAt: now },
    });
    await prisma.quizRun.update({
      where: { id: runId },
      data: { lastActivityAt: now },
    });
    return buildQuestionView(run, { ...item, questionSentAt: now });
  }

  return buildQuestionView(run, item);
};

const finalizeRun = async (runId: number, targetStatus: QuizRunStatus): Promise<QuizSummary | null> => {
  const now = new Date();
  const run = await prisma.quizRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      status: true,
      totalQuestions: true,
      correctCount: true,
      wrongCount: true,
      skippedCount: true,
      startedAt: true,
      durationSeconds: true,
    },
  });
  if (!run) return null;

  if (run.status === 'ACTIVE') {
    const durationSeconds = Math.max(0, Math.round((now.getTime() - run.startedAt.getTime()) / 1000));
    const finalRun = await prisma.quizRun.update({
      where: { id: runId },
      data: {
        status: targetStatus,
        finishedAt: now,
        durationSeconds,
        lastActivityAt: now,
      },
      select: {
        id: true,
        status: true,
        totalQuestions: true,
        correctCount: true,
        wrongCount: true,
        skippedCount: true,
        durationSeconds: true,
      },
    });
    return toQuizSummary(finalRun);
  }

  return toQuizSummary(run);
};

const loadQuizCandidates = async (userId: bigint): Promise<QuizWordCandidate[]> => {
  const reviews = await prisma.review.findMany({
    where: {
      userId,
      stage: { gte: 2 },
    },
    select: {
      wordId: true,
      direction: true,
      word: {
        select: {
          wordEn: true,
          translationRu: true,
          sentenceIndex: true,
          exampleSentences: true,
        },
      },
    },
    orderBy: [{ wordId: 'asc' }, { direction: 'asc' }],
  });

  const dedupe = new Set<string>();
  const out: QuizWordCandidate[] = [];

  for (const review of reviews) {
    const key = `${review.wordId}:${review.direction}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    if (!review.word) continue;
    out.push({
      wordId: review.wordId,
      direction: review.direction,
      wordEn: review.word.wordEn,
      translationRu: review.word.translationRu,
      sentenceIndex: review.word.sentenceIndex,
      exampleSentences: review.word.exampleSentences,
    });
  }

  return out;
};

const consumeDailyQuizStart = async (
  tx: Prisma.TransactionClient,
  userId: bigint,
  dayStart: Date,
): Promise<{ allowed: boolean; usedToday: number }> => {
  const usage = await tx.quizDailyUsage.upsert({
    where: { userId_dayStart: { userId, dayStart } },
    create: { userId, dayStart, startedCount: 0 },
    update: {},
    select: { id: true, startedCount: true },
  });

  if (usage.startedCount >= QUIZ_DAILY_LIMIT) {
    return { allowed: false, usedToday: usage.startedCount };
  }

  const updated = await tx.quizDailyUsage.update({
    where: { id: usage.id },
    data: { startedCount: { increment: 1 } },
    select: { startedCount: true },
  });
  return { allowed: true, usedToday: updated.startedCount };
};

export const startOrResumeQuiz = async (userId: bigint): Promise<StartOrResumeQuizResult> => {
  const activeRun = await prisma.quizRun.findFirst({
    where: { userId, status: 'ACTIVE' },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });

  if (activeRun) {
    const question = await loadQuizQuestion(activeRun.id);
    if (question) {
      console.log('[quiz] resumed', { userId: userId.toString(), runId: activeRun.id });
      return {
        ok: true,
        resumed: true,
        runId: activeRun.id,
        question,
        summary: null,
      };
    }
    const summary = await finalizeRun(activeRun.id, 'COMPLETED');
    return {
      ok: true,
      resumed: true,
      runId: activeRun.id,
      question: null,
      summary,
    };
  }

  const dayStart = await getUserDayStart(userId);
  const candidates = await loadQuizCandidates(userId);
  const rawQuestions = buildQuestionSet(candidates);
  if (rawQuestions.length < QUIZ_TOTAL_QUESTIONS) {
    return {
      ok: false,
      reason: 'INSUFFICIENT_WORDS',
      limit: QUIZ_DAILY_LIMIT,
      usedToday: 0,
      minRequiredWords: 4,
    };
  }

  const created = await prisma.$transaction(async (tx) => {
    const limitState = await consumeDailyQuizStart(tx, userId, dayStart);
    if (!limitState.allowed) {
      return {
        runId: null,
        usedToday: limitState.usedToday,
        limitReached: true,
      };
    }

    const run = await tx.quizRun.create({
      data: {
        userId,
        status: 'ACTIVE',
        totalQuestions: QUIZ_TOTAL_QUESTIONS,
        currentIndex: 0,
      },
      select: { id: true },
    });

    await tx.quizRunItem.createMany({
      data: rawQuestions.map((question) => ({
        runId: run.id,
        questionIndex: question.questionIndex,
        wordId: question.wordId,
        direction: question.direction,
        mode: question.mode,
        promptText: question.promptText,
        options: question.options ? (question.options as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        correctAnswer: question.correctAnswer,
        correctOptionIndex: question.correctOptionIndex,
      })),
    });

    return {
      runId: run.id,
      usedToday: limitState.usedToday,
      limitReached: false,
    };
  });

  if (created.limitReached || !created.runId) {
    return {
      ok: false,
      reason: 'LIMIT_REACHED',
      limit: QUIZ_DAILY_LIMIT,
      usedToday: created.usedToday,
    };
  }

  const question = await loadQuizQuestion(created.runId);
  console.log('[quiz] started', { userId: userId.toString(), runId: created.runId });
  return {
    ok: true,
    resumed: false,
    runId: created.runId,
    question,
    summary: null,
  };
};

export const getCurrentQuestion = async (runId: number): Promise<QuizQuestionView | null> => {
  return loadQuizQuestion(runId);
};

const evaluateAnswer = (
  item: {
    mode: QuizQuestionMode;
    correctOptionIndex: number | null;
    options: Prisma.JsonValue | null;
  },
  selectedOptionIndex: number | null,
  timedOut: boolean,
): { outcome: QuizAnswerOutcome; selectedAnswer: string | null } => {
  if (timedOut) return { outcome: 'SKIPPED', selectedAnswer: null };

  const options = parseOptions(item.options);
  const selectedAnswer =
    selectedOptionIndex !== null && options && selectedOptionIndex >= 0 && selectedOptionIndex < options.length
      ? options[selectedOptionIndex] ?? null
      : null;

  if (selectedOptionIndex === null || item.correctOptionIndex === null) {
    return { outcome: 'SKIPPED', selectedAnswer };
  }

  if (selectedOptionIndex === item.correctOptionIndex) {
    return { outcome: 'CORRECT', selectedAnswer };
  }

  return { outcome: 'WRONG', selectedAnswer };
};

export const submitAnswer = async (
  runId: number,
  questionId: number,
  selectedOptionIndex: number | null,
  answerTimeMs?: number | null,
): Promise<SubmitQuizAnswerResult> => {
  const now = new Date();

  const transactionResult = await prisma.$transaction(async (tx) => {
    const run = await tx.quizRun.findUnique({
      where: { id: runId },
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
    if (!run) return { kind: 'error' as const, reason: 'RUN_NOT_FOUND' as const };
    if (run.status !== 'ACTIVE') return { kind: 'error' as const, reason: 'RUN_NOT_ACTIVE' as const };

    const item = await tx.quizRunItem.findUnique({
      where: { id: questionId },
      select: {
        id: true,
        runId: true,
        questionIndex: true,
        mode: true,
        options: true,
        correctAnswer: true,
        correctOptionIndex: true,
        outcome: true,
        questionSentAt: true,
      },
    });
    if (!item || item.runId !== run.id) return { kind: 'error' as const, reason: 'QUESTION_NOT_FOUND' as const };

    if (item.outcome) {
      const summary = toQuizSummary(run);
      return {
        kind: 'ok' as const,
        duplicate: true,
        stale: false,
        run,
        item,
        outcome: item.outcome,
        selectedAnswer: null,
        timedOut: false,
        nextQuestion: null,
        summary,
      };
    }

    if (item.questionIndex !== run.currentIndex) {
      const summary = toQuizSummary(run);
      return {
        kind: 'ok' as const,
        duplicate: true,
        stale: true,
        run,
        item,
        outcome: 'SKIPPED' as QuizAnswerOutcome,
        selectedAnswer: null,
        timedOut: false,
        nextQuestion: null,
        summary,
      };
    }

    const questionSentAt = item.questionSentAt ?? now;
    const timedOut = now.getTime() > questionSentAt.getTime() + QUIZ_TIME_LIMIT_SECONDS * 1000;
    const evaluated = evaluateAnswer(item, selectedOptionIndex, timedOut);
    const safeAnswerTimeMs = clampAnswerTimeMs(answerTimeMs);

    const claim = await tx.quizRunItem.updateMany({
      where: {
        id: item.id,
        outcome: null,
      },
      data: {
        selectedOptionIndex,
        selectedAnswer: evaluated.selectedAnswer,
        outcome: evaluated.outcome,
        answeredAt: now,
        answerTimeMs: safeAnswerTimeMs,
      },
    });

    if (claim.count === 0) {
      const latestItem = await tx.quizRunItem.findUnique({
        where: { id: item.id },
        select: {
          id: true,
          runId: true,
          questionIndex: true,
          mode: true,
          options: true,
          correctAnswer: true,
          correctOptionIndex: true,
          outcome: true,
          questionSentAt: true,
        },
      });
      const summary = toQuizSummary(run);
      return {
        kind: 'ok' as const,
        duplicate: true,
        stale: false,
        run,
        item: latestItem ?? item,
        outcome: latestItem?.outcome ?? 'SKIPPED',
        selectedAnswer: null,
        timedOut: false,
        nextQuestion: null,
        summary,
      };
    }

    const nextIndex = run.currentIndex + 1;
    const runUpdateData: Prisma.QuizRunUpdateInput = {
      currentIndex: nextIndex,
      lastActivityAt: now,
    };
    if (evaluated.outcome === 'CORRECT') {
      runUpdateData.correctCount = { increment: 1 };
    } else if (evaluated.outcome === 'WRONG') {
      runUpdateData.wrongCount = { increment: 1 };
    } else {
      runUpdateData.skippedCount = { increment: 1 };
    }

    let updatedRun = await tx.quizRun.update({
      where: { id: run.id },
      data: runUpdateData,
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

    if (nextIndex >= run.totalQuestions) {
      const durationSeconds = Math.max(0, Math.round((now.getTime() - run.startedAt.getTime()) / 1000));
      updatedRun = await tx.quizRun.update({
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
    }

    return {
      kind: 'ok' as const,
      duplicate: false,
      stale: false,
      run: updatedRun,
      item,
      outcome: evaluated.outcome,
      selectedAnswer: evaluated.selectedAnswer,
      timedOut,
      nextQuestion: updatedRun.status === 'ACTIVE'
        ? await tx.quizRunItem.findUnique({
            where: {
              runId_questionIndex: {
                runId: run.id,
                questionIndex: updatedRun.currentIndex,
              },
            },
            select: {
              id: true,
              questionIndex: true,
              direction: true,
              mode: true,
              promptText: true,
              options: true,
              questionSentAt: true,
            },
          })
        : null,
      summary: toQuizSummary(updatedRun),
    };
  });

  if (transactionResult.kind === 'error') {
    return { ok: false, reason: transactionResult.reason };
  }

  if (transactionResult.nextQuestion && !transactionResult.nextQuestion.questionSentAt) {
    const sentAt = new Date();
    await prisma.quizRunItem.update({
      where: { id: transactionResult.nextQuestion.id },
      data: { questionSentAt: sentAt },
    });
    await prisma.quizRun.update({
      where: { id: transactionResult.run.id },
      data: { lastActivityAt: sentAt },
    });
    transactionResult.nextQuestion.questionSentAt = sentAt;
  }

  const nextQuestion =
    transactionResult.nextQuestion
      ? buildQuestionView(transactionResult.run, transactionResult.nextQuestion)
      : null;

  const summary = transactionResult.summary;
  if (summary && summary.status !== 'ACTIVE') {
    console.log('[quiz] finished', {
      runId: summary.runId,
      status: summary.status,
      accuracyPercent: summary.accuracyPercent,
      correct: summary.correctCount,
      wrong: summary.wrongCount,
      skipped: summary.skippedCount,
    });
  } else {
    console.log('[quiz] answered', {
      runId,
      questionId,
      outcome: transactionResult.outcome,
      timedOut: transactionResult.timedOut,
      duplicate: transactionResult.duplicate,
      stale: transactionResult.stale,
    });
  }

  return {
    ok: true,
    duplicate: transactionResult.duplicate,
    stale: transactionResult.stale,
    runId: runId,
    questionId,
    outcome: transactionResult.outcome,
    correctAnswer: transactionResult.item.correctAnswer,
    selectedAnswer: transactionResult.selectedAnswer,
    timedOut: transactionResult.timedOut,
    summary,
    nextQuestion,
  };
};

export const finishQuiz = async (runId: number): Promise<QuizSummary | null> => {
  const summary = await finalizeRun(runId, 'ABANDONED');
  if (summary) {
    console.log('[quiz] abandoned', {
      runId: summary.runId,
      accuracyPercent: summary.accuracyPercent,
      correct: summary.correctCount,
      wrong: summary.wrongCount,
      skipped: summary.skippedCount,
    });
  }
  return summary;
};
