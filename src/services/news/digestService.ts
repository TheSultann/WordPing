import { prisma } from '../../db/client';
import { highlightWord } from './matching';
import { NEWS_STAGE_THRESHOLD } from './config';
import { NewsDigestItem, NewsExampleTier } from './types';

const DIGEST_SNIPPET_MAX_CHARS = 200;

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
  let end = Math.min(normalized.length, start + maxChars);
  if (end - start < maxChars) {
    start = Math.max(0, end - maxChars);
  }

  let snippet = normalized.slice(start, end).trim();
  if (start > 0) snippet = `...${snippet}`;
  if (end < normalized.length) snippet = `${snippet}...`;
  return snippet;
};

const hasHighlightedWord = (value: string): boolean => /<b>.*?<\/b>/i.test(value);

export const buildUserNewsDigest = async (userId: bigint, limit = 3): Promise<NewsDigestItem[]> => {
  const limitCount = Math.max(1, limit);
  const fetchCount = Math.min(30, Math.max(limitCount * 6, limitCount));

  // Fetch a larger random pool; we may skip rows that do not contain a visible match.
  const selectedRows = await prisma.$queryRaw<{
    id: number;
    wordEn: string;
    translationRu: string;
    newsExampleText: string;
    newsExampleMatchedWord: string | null;
    newsExampleTier: NewsExampleTier;
    newsExampleSourceUrl: string | null;
    newsExampleSourceTitle: string | null;
  }[]>`
    SELECT id, "wordEn", "translationRu", "newsExampleText", "newsExampleMatchedWord", "newsExampleTier", "newsExampleSourceUrl", "newsExampleSourceTitle"
    FROM "Word"
    WHERE "userId" = ${userId}
      AND "newsExampleText" IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM "Review" 
        WHERE "Review"."wordId" = "Word".id AND "Review".stage >= ${NEWS_STAGE_THRESHOLD}
      )
    ORDER BY random()
    LIMIT ${fetchCount}
  `;

  await prisma.user.updateMany({
    where: { id: userId },
    data: { newsDigestLastOpenedAt: new Date() },
  });

  const digest: NewsDigestItem[] = [];

  for (const word of selectedRows) {
    if (digest.length >= limitCount) break;

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
      const titleSnippet = sliceAroundTerm(word.newsExampleSourceTitle, term, DIGEST_SNIPPET_MAX_CHARS);
      const highlightedTitle = highlightWord(titleSnippet, term);
      if (hasHighlightedWord(highlightedTitle)) {
        highlighted = highlightedTitle;
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

  return digest;
};

