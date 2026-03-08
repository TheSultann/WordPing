import { escapeHtml } from './html';

const TOKEN_RE = /[\p{L}\p{N}]+(?:[\u2019'`\u02BB\u02BC-][\p{L}\p{N}]+)*/gu;

type MatchRange = {
  start: number;
  end: number;
};

type IndexedToken = {
  normalized: string;
  start: number;
  end: number;
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const collapseSpaces = (value: string): string => value.trim().replace(/\s+/g, ' ');

const tokenize = (value: string): string[] => value.match(TOKEN_RE) ?? [];

const tokenizeWithIndex = (value: string): IndexedToken[] => {
  const tokens: IndexedToken[] = [];
  for (const match of value.matchAll(TOKEN_RE)) {
    const token = match[0];
    if (!token || typeof match.index !== 'number') continue;
    tokens.push({
      normalized: token.toLowerCase(),
      start: match.index,
      end: match.index + token.length,
    });
  }
  return tokens;
};

const buildExactRegex = (target: string, flags = 'iu'): RegExp | null => {
  const normalized = collapseSpaces(target);
  if (!normalized) return null;
  const pattern = escapeRegex(normalized).replace(/\s+/g, '\\s+');
  return new RegExp(pattern, flags);
};

const sharedPrefixLength = (left: string, right: string): number => {
  const l = Array.from(left);
  const r = Array.from(right);
  const max = Math.min(l.length, r.length);
  let index = 0;
  while (index < max && l[index] === r[index]) {
    index += 1;
  }
  return index;
};

const isLooseTokenMatch = (target: string, candidate: string): boolean => {
  if (!target || !candidate) return false;
  const targetLen = Array.from(target).length;
  const minPrefix =
    targetLen <= 2
      ? targetLen
      : targetLen <= 4
        ? 3
        : Math.max(3, Math.floor(targetLen * 0.6));
  return sharedPrefixLength(target, candidate) >= minPrefix;
};

const findLooseRanges = (text: string, target: string): MatchRange[] => {
  const sourceTokens = tokenizeWithIndex(text);
  const targetTokens = tokenize(target).map((item) => item.toLowerCase());
  if (!sourceTokens.length || !targetTokens.length || sourceTokens.length < targetTokens.length) return [];

  const windowSize = targetTokens.length;
  const ranges: MatchRange[] = [];
  let index = 0;
  while (index <= sourceTokens.length - windowSize) {
    let valid = true;
    for (let offset = 0; offset < windowSize; offset += 1) {
      const sourceToken = sourceTokens[index + offset];
      const targetToken = targetTokens[offset];
      if (!sourceToken || !targetToken || !isLooseTokenMatch(targetToken, sourceToken.normalized)) {
        valid = false;
        break;
      }
    }
    if (!valid) {
      index += 1;
      continue;
    }

    const startToken = sourceTokens[index];
    const endToken = sourceTokens[index + windowSize - 1];
    if (!startToken || !endToken) {
      index += 1;
      continue;
    }
    ranges.push({ start: startToken.start, end: endToken.end });
    // Skip matched window to avoid overlapping replacements.
    index += windowSize;
  }

  return ranges;
};

const findMatchRanges = (text: string, target: string): MatchRange[] => {
  const source = text ?? '';
  const normalizedTarget = collapseSpaces(target);
  if (!source.trim() || !normalizedTarget) return [];

  const exactRegex = buildExactRegex(normalizedTarget, 'giu');
  if (exactRegex) {
    const exactRanges: MatchRange[] = [];
    for (const match of source.matchAll(exactRegex)) {
      const chunk = match[0];
      if (!chunk || typeof match.index !== 'number') continue;
      exactRanges.push({ start: match.index, end: match.index + chunk.length });
    }
    if (exactRanges.length) return exactRanges;
  }

  return findLooseRanges(source, normalizedTarget);
};

const findMatchRange = (text: string, target: string): MatchRange | null => {
  const ranges = findMatchRanges(text, target);
  return ranges[0] ?? null;
};

const renderWithRanges = (text: string, ranges: MatchRange[], middle: string): string => {
  const source = text ?? '';
  if (!ranges.length) return escapeHtml(source);

  let lastEnd = 0;
  let rendered = '';
  for (const range of ranges) {
    const start = Math.max(lastEnd, range.start);
    const end = Math.max(start, range.end);
    rendered += `${escapeHtml(source.slice(lastEnd, start))}${middle}`;
    lastEnd = end;
  }

  rendered += escapeHtml(source.slice(lastEnd));
  return rendered;
};

const renderWithRange = (text: string, range: MatchRange | null, middle: string): string => {
  const source = text ?? '';
  if (!range) return escapeHtml(source);

  return `${escapeHtml(source.slice(0, range.start))}${middle}${escapeHtml(source.slice(range.end))}`;
};

export const highlightTargetInSentence = (text: string, target: string): string => {
  const source = text ?? '';
  const range = findMatchRange(source, target);
  if (!range) return escapeHtml(source);
  const matched = source.slice(range.start, range.end);
  return renderWithRange(source, range, `<u><b>${escapeHtml(matched)}</b></u>`);
};

export const blankTargetInSentence = (text: string, target: string): string => {
  const source = text ?? '';
  return renderWithRanges(source, findMatchRanges(source, target), '___');
};
