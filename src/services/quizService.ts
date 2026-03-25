import type { CardDirection, QuizAnswerOutcome, QuizQuestionMode, QuizRunStatus, ReviewResult } from '../generated/prisma/client';
import { Prisma } from '../generated/prisma/client';
import { prisma } from '../db/client';
import { toExampleSentenceArray } from './sentenceService';
import { createLogger } from '../utils/logger';
import { highlightTargetInSentence } from '../utils/reviewCardText';
import { nowUtc, startOfUserDay } from '../utils/time';
import { logSelectionDebug } from '../utils/selectionDebug';
import { loadRecentDirectionalQuizStats } from './quizUsageService';

const quizLogger = createLogger('quiz-service');

export const QUIZ_DAILY_LIMIT = 100;
export const QUIZ_TOTAL_QUESTIONS = 10;
export const QUIZ_TIME_LIMIT_SECONDS = 25;
const QUIZ_MIN_WORDS_REQUIRED = 4;
const QUIZ_PRIORITY_LOOKBACK_DAYS = 21;

const QUIZ_MODES: readonly QuizQuestionMode[] = ['MULTIPLE_CHOICE', 'TRUE_FALSE', 'FILL_GAP'];
const QUIZ_DIRECTIONS: readonly CardDirection[] = ['EN_TO_RU', 'RU_TO_EN'];

type QuizWordCandidate = {
  wordId: number;
  wordEn: string;
  translationRu: string;
  sentenceIndex: number;
  exampleSentences: Prisma.JsonValue | null;
  direction: CardDirection;
  stage: number;
  intervalMinutes: number;
  hardStreak: number;
  lastResult: ReviewResult | null;
  lastReviewAt: Date | null;
  nextReviewAt: Date | null;
  reviewCreatedAt: Date;
  recentStats: RecentDirectionalQuizStats | null;
  priorityDebug: QuizPriorityDebug;
  priorityScore: number;
};

type RecentDirectionalQuizStats = {
  lastSeenAt: Date | null;
  seenCount: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  recentCorrectStreak: number;
};

type QuizPriorityDebug = {
  stageBonus: number;
  reviewRecencyBonus: number;
  overdueBonus: number;
  difficultyBonus: number;
  recentFailureBonus: number;
  recentSeenPenalty: number;
  recentSuccessPenalty: number;
  totalScore: number;
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

const hoursSince = (now: Date, value: Date | null | undefined): number => {
  if (!value) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - value.getTime()) / (60 * 60 * 1000));
};

const quizCandidateKey = (wordId: number, direction: CardDirection): string => `${wordId}:${direction}`;

const quizStagePriorityBonus = (stage: number): number => {
  if (stage <= 2) return 18;
  if (stage <= 4) return 22;
  if (stage <= 6) return 16;
  if (stage <= 8) return 8;
  return 2;
};

const quizReviewRecencyBonus = (hours: number): number => {
  if (!Number.isFinite(hours)) return 14;
  if (hours >= 24 * 14) return 18;
  if (hours >= 24 * 7) return 14;
  if (hours >= 24 * 3) return 10;
  if (hours >= 24) return 7;
  if (hours >= 12) return 4;
  return 0;
};

const quizOverdueBonus = (hours: number): number => {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  if (hours >= 24 * 7) return 18;
  if (hours >= 24) return 12;
  if (hours >= 6) return 6;
  return 2;
};

const quizRecentSeenPenalty = (hours: number): number => {
  if (!Number.isFinite(hours)) return 0;
  if (hours < 12) return 40;
  if (hours < 24) return 28;
  if (hours < 72) return 16;
  if (hours < 24 * 7) return 8;
  return 0;
};

const buildQuizPriorityDebug = (
  candidate: Omit<QuizWordCandidate, 'priorityScore'>,
  stats: RecentDirectionalQuizStats | undefined,
  now: Date,
): QuizPriorityDebug => {
  const reviewAnchor = candidate.lastReviewAt ?? candidate.reviewCreatedAt;
  const reviewAgeHours = hoursSince(now, reviewAnchor);
  const overdueHours = candidate.nextReviewAt
    ? Math.max(0, (now.getTime() - candidate.nextReviewAt.getTime()) / (60 * 60 * 1000))
    : 0;
  const lastSeenHours = hoursSince(now, stats?.lastSeenAt);

  const difficultyBonus =
    Math.min(18, candidate.hardStreak * 6) +
    (candidate.lastResult === 'INCORRECT' ? 18 : candidate.lastResult === 'SKIPPED' ? 10 : 0);
  const recentFailureBonus = Math.min(20, (stats?.wrongCount ?? 0) * 8 + (stats?.skippedCount ?? 0) * 5);
  const recentSuccessPenalty = Math.min(18, (stats?.correctCount ?? 0) * 3 + (stats?.recentCorrectStreak ?? 0) * 4);

  const stageBonus = quizStagePriorityBonus(candidate.stage);
  const reviewRecencyBonus = quizReviewRecencyBonus(reviewAgeHours);
  const overdueBonus = quizOverdueBonus(overdueHours);
  const recentSeenPenalty = quizRecentSeenPenalty(lastSeenHours);
  const totalScore =
    50 +
    stageBonus +
    reviewRecencyBonus +
    overdueBonus +
    difficultyBonus +
    recentFailureBonus -
    recentSeenPenalty -
    recentSuccessPenalty;

  return {
    stageBonus,
    reviewRecencyBonus,
    overdueBonus,
    difficultyBonus,
    recentFailureBonus,
    recentSeenPenalty,
    recentSuccessPenalty,
    totalScore,
  };
};

const compareQuizCandidates = (left: QuizWordCandidate, right: QuizWordCandidate): number => {
  if (right.priorityScore !== left.priorityScore) return right.priorityScore - left.priorityScore;

  const leftNext = left.nextReviewAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightNext = right.nextReviewAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (leftNext !== rightNext) return leftNext - rightNext;

  if (right.stage !== left.stage) return right.stage - left.stage;
  return left.wordId - right.wordId;
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

const buildDirectionSequence = (totalQuestions: number): CardDirection[] => {
  const safeTotalQuestions = Math.max(0, totalQuestions);
  const perDirection = Math.floor(safeTotalQuestions / QUIZ_DIRECTIONS.length);
  const sequence: CardDirection[] = [];
  for (const direction of QUIZ_DIRECTIONS) {
    for (let index = 0; index < perDirection; index += 1) {
      sequence.push(direction);
    }
  }
  while (sequence.length < safeTotalQuestions) {
    sequence.push(QUIZ_DIRECTIONS[sequence.length % QUIZ_DIRECTIONS.length] ?? 'EN_TO_RU');
  }
  return shuffle(sequence);
};

const buildModeSequence = (totalQuestions: number): QuizQuestionMode[] => {
  const modes: QuizQuestionMode[] = [];
  for (let index = 0; index < totalQuestions; index += 1) {
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
    return highlightTargetInSentence(sentence.en, candidate.wordEn);
  }
  return highlightTargetInSentence(sentence.native, candidate.translationRu);
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

const selectRunCandidates = (candidates: QuizWordCandidate[]): QuizWordCandidate[] => {
  if (!candidates.length) return [];

  const totalQuestions = Math.min(QUIZ_TOTAL_QUESTIONS, new Set(candidates.map((item) => item.wordId)).size);
  if (totalQuestions <= 0) return [];

  const preferredDirections = buildDirectionSequence(totalQuestions);
  const selected: QuizWordCandidate[] = [];
  const usedWordIds = new Set<number>();

  const takeBestCandidate = (direction?: CardDirection): QuizWordCandidate | null => {
    for (const candidate of candidates) {
      if (usedWordIds.has(candidate.wordId)) continue;
      if (direction && candidate.direction !== direction) continue;
      usedWordIds.add(candidate.wordId);
      return candidate;
    }
    return null;
  };

  for (const direction of preferredDirections) {
    const candidate = takeBestCandidate(direction) ?? takeBestCandidate();
    if (!candidate) break;
    selected.push(candidate);
  }

  return selected;
};

const formatQuizCandidateForDebug = (candidate: QuizWordCandidate) => ({
  wordId: candidate.wordId,
  wordEn: candidate.wordEn,
  direction: candidate.direction,
  score: candidate.priorityScore,
  stage: candidate.stage,
  lastResult: candidate.lastResult,
  hardStreak: candidate.hardStreak,
  recentStats: candidate.recentStats,
  breakdown: candidate.priorityDebug,
});

const logQuizSelection = (
  userId: bigint,
  candidates: QuizWordCandidate[],
  selectedCandidates: QuizWordCandidate[],
): void => {
  logSelectionDebug('quiz', 'ranking', {
    userId: userId.toString(),
    totalCandidates: candidates.length,
    selectedCount: selectedCandidates.length,
    selectedCandidates: selectedCandidates.map(formatQuizCandidateForDebug),
    topCandidates: candidates.slice(0, 12).map(formatQuizCandidateForDebug),
  });
};

const buildQuestionSet = (
  selectedCandidates: QuizWordCandidate[],
  allCandidates: QuizWordCandidate[],
): RawQuestion[] => {
  const byDirection: Record<CardDirection, QuizWordCandidate[]> = {
    EN_TO_RU: selectedCandidates
      .filter((item) => item.direction === 'EN_TO_RU')
      .sort(compareQuizCandidates),
    RU_TO_EN: selectedCandidates
      .filter((item) => item.direction === 'RU_TO_EN')
      .sort(compareQuizCandidates),
  };

  const nativeAnswerPool = uniqueStrings(
    allCandidates
      .filter((item) => item.direction === 'EN_TO_RU')
      .map((item) => item.translationRu),
  );
  const englishAnswerPool = uniqueStrings(
    allCandidates
      .filter((item) => item.direction === 'RU_TO_EN')
      .map((item) => item.wordEn),
  );

  if (nativeAnswerPool.length < 4 || englishAnswerPool.length < 4) return [];
  if (!selectedCandidates.length) return [];

  const directionSequence = selectedCandidates.map((item) => item.direction);
  const modeSequence = buildModeSequence(selectedCandidates.length);
  const pointers: Record<CardDirection, number> = { EN_TO_RU: 0, RU_TO_EN: 0 };
  const out: RawQuestion[] = [];

  for (let index = 0; index < selectedCandidates.length; index += 1) {
    const direction = directionSequence[index] ?? selectedCandidates[index]?.direction ?? 'EN_TO_RU';
    const mode = modeSequence[index] ?? 'MULTIPLE_CHOICE';
    const pool = byDirection[direction];
    if (!pool.length) return [];

    const pointer = pointers[direction];
    pointers[direction] += 1;
    const candidate = pool[pointer];
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

const getUserDayStart = async (userId: bigint): Promise<Date> => {
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
  const now = new Date();
  const lookbackSince = new Date(now.getTime() - QUIZ_PRIORITY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const reviews = await prisma.review.findMany({
    where: {
      userId,
      stage: { gte: 2 },
    },
    select: {
      wordId: true,
      direction: true,
      stage: true,
      intervalMinutes: true,
      hardStreak: true,
      lastResult: true,
      lastReviewAt: true,
      nextReviewAt: true,
      createdAt: true,
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
  const candidateWordIds = [...new Set(reviews.map((review) => review.wordId))];
  const recentUsageStats = await loadRecentDirectionalQuizStats(userId, lookbackSince, candidateWordIds);

  const dedupe = new Set<string>();
  const recentStatsByDirection = new Map<string, RecentDirectionalQuizStats>(
    recentUsageStats.map((row) => [quizCandidateKey(row.wordId, row.direction), row]),
  );
  const out: QuizWordCandidate[] = [];

  for (const review of reviews) {
    const key = `${review.wordId}:${review.direction}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    if (!review.word) continue;
    const recentStats = recentStatsByDirection.get(quizCandidateKey(review.wordId, review.direction)) ?? null;
    const candidateBase = {
      wordId: review.wordId,
      direction: review.direction,
      wordEn: review.word.wordEn,
      translationRu: review.word.translationRu,
      sentenceIndex: review.word.sentenceIndex,
      exampleSentences: review.word.exampleSentences,
      stage: review.stage,
      intervalMinutes: review.intervalMinutes,
      hardStreak: review.hardStreak,
      lastResult: review.lastResult,
      lastReviewAt: review.lastReviewAt,
      nextReviewAt: review.nextReviewAt,
      reviewCreatedAt: review.createdAt,
      recentStats,
      priorityDebug: {
        stageBonus: 0,
        reviewRecencyBonus: 0,
        overdueBonus: 0,
        difficultyBonus: 0,
        recentFailureBonus: 0,
        recentSeenPenalty: 0,
        recentSuccessPenalty: 0,
        totalScore: 0,
      },
    } satisfies Omit<QuizWordCandidate, 'priorityScore'>;
    const priorityDebug = buildQuizPriorityDebug(candidateBase, recentStats ?? undefined, now);

    out.push({
      ...candidateBase,
      priorityDebug,
      priorityScore: priorityDebug.totalScore,
    });
  }

  return out.sort(compareQuizCandidates);
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
      quizLogger.info('quiz resumed', { userId: userId.toString(), runId: activeRun.id });
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
  const selectedCandidates = selectRunCandidates(candidates);
  logQuizSelection(userId, candidates, selectedCandidates);
  const rawQuestions = buildQuestionSet(selectedCandidates, candidates);
  if (rawQuestions.length < QUIZ_MIN_WORDS_REQUIRED) {
    return {
      ok: false,
      reason: 'INSUFFICIENT_WORDS',
      limit: QUIZ_DAILY_LIMIT,
      usedToday: 0,
      minRequiredWords: QUIZ_MIN_WORDS_REQUIRED,
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
        totalQuestions: rawQuestions.length,
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
  quizLogger.info('quiz started', { userId: userId.toString(), runId: created.runId });
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
    quizLogger.info('quiz finished', {
      runId: summary.runId,
      status: summary.status,
      accuracyPercent: summary.accuracyPercent,
      correct: summary.correctCount,
      wrong: summary.wrongCount,
      skipped: summary.skippedCount,
    });
  } else {
    quizLogger.info('quiz answered', {
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
    quizLogger.info('quiz abandoned', {
      runId: summary.runId,
      accuracyPercent: summary.accuracyPercent,
      correct: summary.correctCount,
      wrong: summary.wrongCount,
      skipped: summary.skippedCount,
    });
  }
  return summary;
};
