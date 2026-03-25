import { prisma } from '../../db/client';
import { highlightWord } from './matching';
import { NEWS_STAGE_THRESHOLD } from './config';
import type { NewsDigestItem, NewsExampleTier } from './types';
import { loadRecentWordQuizStats } from '../quizUsageService';
import { logSelectionDebug } from '../../utils/selectionDebug';

const DIGEST_SNIPPET_MAX_CHARS = 200;
const NEWS_PRIORITY_LOOKBACK_DAYS = 21;

type DigestWordCandidate = {
  id: number;
  wordEn: string;
  translationRu: string;
  newsExampleText: string;
  newsExampleMatchedWord: string | null;
  newsExampleTier: NewsExampleTier | null;
  newsExampleSourceUrl: string | null;
  newsExampleSourceTitle: string | null;
  newsExamplePreparedAt: Date | null;
  maxStage: number;
  lastReviewAt: Date | null;
  recentStats: RecentWordQuizStats | null;
  priorityDebug: DigestPriorityDebug;
  priorityScore: number;
};

type RecentWordQuizStats = {
  lastSeenAt: Date | null;
  seenCount: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  recentCorrectStreak: number;
};

type DigestPriorityDebug = {
  freshnessBonus: number;
  stageBonus: number;
  recentFailureBonus: number;
  tierBonus: number;
  recentQuizPenalty: number;
  recentSuccessPenalty: number;
  totalScore: number;
};

const normalizeSpaces = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

const truncateText = (value: string, maxChars: number): string => {
  const normalized = normalizeSpaces(value);
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(1, maxChars - 3)).trimEnd()}...`;
};

const sliceAroundTerm = (value: string, term: string, maxChars: number): string => {
  const normalized = normalizeSpaces(value);
  if (!normalized) return '';
  if (normalized.length <= maxChars) return normalized;

  const termNorm = normalizeSpaces(term).toLowerCase();
  if (!termNorm) return truncateText(normalized, maxChars);

  const haystack = normalized.toLowerCase();
  const termIndex = haystack.indexOf(termNorm);
  if (termIndex < 0) return truncateText(normalized, maxChars);

  const leading = Math.floor(maxChars * 0.35);
  let start = Math.max(0, termIndex - leading);
  const end = Math.min(normalized.length, start + maxChars);
  if (end - start < maxChars) {
    start = Math.max(0, end - maxChars);
  }

  let snippet = normalized.slice(start, end).trim();
  if (start > 0) snippet = `...${snippet}`;
  if (end < normalized.length) snippet = `${snippet}...`;
  return snippet;
};

const hasHighlightedWord = (value: string): boolean => /<b>.*?<\/b>/i.test(value);

const hoursSince = (now: Date, value: Date | null | undefined): number => {
  if (!value) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - value.getTime()) / (60 * 60 * 1000));
};

const newsFreshnessBonus = (hours: number): number => {
  if (!Number.isFinite(hours)) return 0;
  if (hours <= 6) return 28;
  if (hours <= 24) return 22;
  if (hours <= 24 * 3) return 16;
  if (hours <= 24 * 7) return 10;
  return 4;
};

const newsStageBonus = (stage: number): number => {
  if (stage >= 10) return 20;
  if (stage >= 8) return 16;
  if (stage >= 6) return 12;
  if (stage >= 4) return 8;
  return 0;
};

const newsTierBonus = (tier: NewsExampleTier | null): number => {
  switch (tier) {
    case 'CACHE':
      return 12;
    case 'GUARDIAN':
      return 10;
    case 'NEWSDATA':
      return 8;
    case 'GDELT':
      return 6;
    case 'AI':
      return 4;
    default:
      return 0;
  }
};

const newsRecentQuizPenalty = (hours: number): number => {
  if (!Number.isFinite(hours)) return 0;
  if (hours < 12) return 40;
  if (hours < 24) return 28;
  if (hours < 72) return 16;
  if (hours < 24 * 7) return 8;
  return 0;
};

const newsRecentFailureBonus = (stats: RecentWordQuizStats | undefined): number =>
  Math.min(18, (stats?.wrongCount ?? 0) * 6 + (stats?.skippedCount ?? 0) * 4);

const buildDigestPriorityDebug = (
  candidate: Omit<DigestWordCandidate, 'priorityScore'>,
  stats: RecentWordQuizStats | undefined,
  now: Date,
): DigestPriorityDebug => {
  const recentSuccessPenalty = Math.min(18, (stats?.correctCount ?? 0) * 2 + (stats?.recentCorrectStreak ?? 0) * 4);
  const freshnessBonus = newsFreshnessBonus(hoursSince(now, candidate.newsExamplePreparedAt));
  const stageBonus = newsStageBonus(candidate.maxStage);
  const recentFailureBonus = newsRecentFailureBonus(stats);
  const tierBonus = newsTierBonus(candidate.newsExampleTier);
  const recentQuizPenalty = newsRecentQuizPenalty(hoursSince(now, stats?.lastSeenAt));
  const totalScore =
    30 +
    freshnessBonus +
    stageBonus +
    recentFailureBonus +
    tierBonus -
    recentQuizPenalty -
    recentSuccessPenalty;

  return {
    freshnessBonus,
    stageBonus,
    recentFailureBonus,
    tierBonus,
    recentQuizPenalty,
    recentSuccessPenalty,
    totalScore,
  };
};

const compareDigestWords = (left: DigestWordCandidate, right: DigestWordCandidate): number => {
  if (right.priorityScore !== left.priorityScore) return right.priorityScore - left.priorityScore;

  const rightPreparedAt = right.newsExamplePreparedAt?.getTime() ?? 0;
  const leftPreparedAt = left.newsExamplePreparedAt?.getTime() ?? 0;
  if (rightPreparedAt !== leftPreparedAt) return rightPreparedAt - leftPreparedAt;

  if (right.maxStage !== left.maxStage) return right.maxStage - left.maxStage;
  return right.id - left.id;
};

const formatDigestCandidateForDebug = (
  candidate: DigestWordCandidate,
  selectedWordIds: Set<number>,
) => ({
  wordId: candidate.id,
  wordEn: candidate.wordEn,
  score: candidate.priorityScore,
  tier: candidate.newsExampleTier,
  maxStage: candidate.maxStage,
  selected: selectedWordIds.has(candidate.id),
  recentStats: candidate.recentStats,
  breakdown: candidate.priorityDebug,
});

export const buildUserNewsDigest = async (
  userId: bigint,
  limit?: number | null
): Promise<NewsDigestItem[]> => {
  const limitCount = typeof limit === 'number' && Number.isFinite(limit) && limit > 0
    ? Math.floor(limit)
    : null;
  const now = new Date();
  const lookbackSince = new Date(now.getTime() - NEWS_PRIORITY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const words = await prisma.word.findMany({
    where: {
      userId,
      newsExampleText: { not: null },
      reviews: {
        some: {
          stage: { gte: NEWS_STAGE_THRESHOLD },
        },
      },
    },
    select: {
      id: true,
      wordEn: true,
      translationRu: true,
      newsExampleText: true,
      newsExampleMatchedWord: true,
      newsExampleTier: true,
      newsExampleSourceUrl: true,
      newsExampleSourceTitle: true,
      newsExamplePreparedAt: true,
      reviews: {
        where: {
          stage: { gte: NEWS_STAGE_THRESHOLD },
        },
        select: {
          stage: true,
          lastReviewAt: true,
        },
      },
    },
  });
  const candidateWordIds = words.map((word) => word.id);
  const recentUsageStats = await loadRecentWordQuizStats(userId, lookbackSince, candidateWordIds);
  const recentStatsByWord = new Map<number, RecentWordQuizStats>(
    recentUsageStats.map((row) => [row.wordId, row]),
  );
  const selectedRows: DigestWordCandidate[] = words
    .map((word) => {
      const recentStats = recentStatsByWord.get(word.id) ?? null;
      const maxStage = word.reviews.reduce((max, review) => Math.max(max, review.stage), 0);
      const lastReviewAt = word.reviews.reduce<Date | null>((latest, review) => {
        if (!review.lastReviewAt) return latest;
        if (!latest || review.lastReviewAt.getTime() > latest.getTime()) {
          return review.lastReviewAt;
        }
        return latest;
      }, null);

      const candidateBase = {
        id: word.id,
        wordEn: word.wordEn,
        translationRu: word.translationRu,
        newsExampleText: word.newsExampleText ?? '',
        newsExampleMatchedWord: word.newsExampleMatchedWord,
        newsExampleTier: word.newsExampleTier,
        newsExampleSourceUrl: word.newsExampleSourceUrl,
        newsExampleSourceTitle: word.newsExampleSourceTitle,
        newsExamplePreparedAt: word.newsExamplePreparedAt,
        maxStage,
        lastReviewAt,
        recentStats,
        priorityDebug: {
          freshnessBonus: 0,
          stageBonus: 0,
          recentFailureBonus: 0,
          tierBonus: 0,
          recentQuizPenalty: 0,
          recentSuccessPenalty: 0,
          totalScore: 0,
        },
      } satisfies Omit<DigestWordCandidate, 'priorityScore'>;
      const priorityDebug = buildDigestPriorityDebug(candidateBase, recentStats ?? undefined, now);

      return {
        ...candidateBase,
        priorityDebug,
        priorityScore: priorityDebug.totalScore,
      };
    })
    .sort(compareDigestWords);

  await prisma.user.updateMany({
    where: { id: userId },
    data: { newsDigestLastOpenedAt: new Date() },
  });

  const digest: NewsDigestItem[] = [];

  for (const word of selectedRows) {
    if (limitCount !== null && digest.length >= limitCount) break;

    const matchedWord = normalizeSpaces(word.newsExampleMatchedWord ?? '');
    const fallbackWord = normalizeSpaces(word.wordEn);
    const term = matchedWord || fallbackWord;
    const baseText = word.newsExampleText ?? '';

    if (!term || !baseText) continue;

    const quoteSnippet = sliceAroundTerm(baseText, term, DIGEST_SNIPPET_MAX_CHARS);
    let highlighted = highlightWord(quoteSnippet, term);

    if (!hasHighlightedWord(highlighted) && term.toLowerCase() !== fallbackWord.toLowerCase()) {
      highlighted = highlightWord(quoteSnippet, fallbackWord);
    }

    // As a final fallback, try source title if quote text has no visible matched word.
    if (!hasHighlightedWord(highlighted) && word.newsExampleSourceTitle) {
      const titleTerms = term.toLowerCase() === fallbackWord.toLowerCase()
        ? [term]
        : [term, fallbackWord];

      for (const titleTerm of titleTerms) {
        const titleSnippet = sliceAroundTerm(word.newsExampleSourceTitle, titleTerm, DIGEST_SNIPPET_MAX_CHARS);
        const highlightedTitle = highlightWord(titleSnippet, titleTerm);
        if (hasHighlightedWord(highlightedTitle)) {
          highlighted = highlightedTitle;
          break;
        }
      }
    }

    if (!hasHighlightedWord(highlighted)) continue;

    digest.push({
      wordId: word.id,
      wordEn: word.wordEn,
      translation: normalizeSpaces(word.translationRu ?? '') || null,
      highlightedText: highlighted,
      tier: word.newsExampleTier ?? 'GDELT',
      sourceUrl: word.newsExampleSourceUrl ?? null,
      sourceTitle: word.newsExampleSourceTitle ?? null,
    });
  }

  const selectedWordIds = new Set(digest.map((item) => item.wordId));
  logSelectionDebug('news', 'digest-ranking', {
    userId: userId.toString(),
    limit: limitCount,
    candidateCount: selectedRows.length,
    digestCount: digest.length,
    digestWords: digest.map((item, index) => ({
      index,
      wordId: item.wordId,
      wordEn: item.wordEn,
      tier: item.tier,
    })),
    topCandidates: selectedRows.slice(0, 12).map((candidate) => formatDigestCandidateForDebug(candidate, selectedWordIds)),
  });

  return digest;
};

