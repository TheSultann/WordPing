import type { CardDirection} from '../generated/prisma/client';
import { Prisma } from '../generated/prisma/client';
import { prisma } from '../db/client';

export type RecentDirectionalQuizStatsRow = {
  wordId: number;
  direction: CardDirection;
  lastSeenAt: Date;
  seenCount: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  recentCorrectStreak: number;
};

export type RecentWordQuizStatsRow = {
  wordId: number;
  lastSeenAt: Date;
  seenCount: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  recentCorrectStreak: number;
};

const buildWordIdsFilter = (wordIds?: number[]): Prisma.Sql => {
  if (!wordIds) return Prisma.empty;
  if (!wordIds.length) return Prisma.sql`AND FALSE`;
  return Prisma.sql`AND item."wordId" IN (${Prisma.join(wordIds)})`;
};

export const loadRecentDirectionalQuizStats = async (
  userId: bigint,
  since: Date,
  wordIds?: number[],
): Promise<RecentDirectionalQuizStatsRow[]> => {
  return prisma.$queryRaw<RecentDirectionalQuizStatsRow[]>`
    WITH ranked AS (
      SELECT
        item."wordId",
        item."direction",
        item."outcome",
        item."questionSentAt",
        SUM(CASE WHEN item."outcome" = 'CORRECT' THEN 0 ELSE 1 END)
          OVER (
            PARTITION BY item."wordId", item."direction"
            ORDER BY item."questionSentAt" DESC, item.id DESC
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS "nonCorrectSeen"
      FROM "QuizRunItem" item
      INNER JOIN "QuizRun" run
        ON run.id = item."runId"
      WHERE run."userId" = ${userId}
        AND item."questionSentAt" IS NOT NULL
        AND item."questionSentAt" >= ${since}
        ${buildWordIdsFilter(wordIds)}
    )
    SELECT
      "wordId",
      "direction",
      MAX("questionSentAt") AS "lastSeenAt",
      COUNT(*)::int AS "seenCount",
      COUNT(*) FILTER (WHERE "outcome" = 'CORRECT')::int AS "correctCount",
      COUNT(*) FILTER (WHERE "outcome" = 'WRONG')::int AS "wrongCount",
      COUNT(*) FILTER (WHERE "outcome" = 'SKIPPED')::int AS "skippedCount",
      COUNT(*) FILTER (WHERE "outcome" = 'CORRECT' AND "nonCorrectSeen" = 0)::int AS "recentCorrectStreak"
    FROM ranked
    GROUP BY "wordId", "direction"
  `;
};

export const loadRecentWordQuizStats = async (
  userId: bigint,
  since: Date,
  wordIds?: number[],
): Promise<RecentWordQuizStatsRow[]> => {
  return prisma.$queryRaw<RecentWordQuizStatsRow[]>`
    WITH ranked AS (
      SELECT
        item."wordId",
        item."outcome",
        item."questionSentAt",
        SUM(CASE WHEN item."outcome" = 'CORRECT' THEN 0 ELSE 1 END)
          OVER (
            PARTITION BY item."wordId"
            ORDER BY item."questionSentAt" DESC, item.id DESC
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS "nonCorrectSeen"
      FROM "QuizRunItem" item
      INNER JOIN "QuizRun" run
        ON run.id = item."runId"
      WHERE run."userId" = ${userId}
        AND item."questionSentAt" IS NOT NULL
        AND item."questionSentAt" >= ${since}
        ${buildWordIdsFilter(wordIds)}
    )
    SELECT
      "wordId",
      MAX("questionSentAt") AS "lastSeenAt",
      COUNT(*)::int AS "seenCount",
      COUNT(*) FILTER (WHERE "outcome" = 'CORRECT')::int AS "correctCount",
      COUNT(*) FILTER (WHERE "outcome" = 'WRONG')::int AS "wrongCount",
      COUNT(*) FILTER (WHERE "outcome" = 'SKIPPED')::int AS "skippedCount",
      COUNT(*) FILTER (WHERE "outcome" = 'CORRECT' AND "nonCorrectSeen" = 0)::int AS "recentCorrectStreak"
    FROM ranked
    GROUP BY "wordId"
  `;
};
