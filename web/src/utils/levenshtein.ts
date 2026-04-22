const ARTICLE_RE = /^(a|an|the)$/i;

const normalizeToken = (value: string) =>
  value
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim();

export const normalizeEnglishAnswer = (value: string) =>
  normalizeToken(value)
    .split(/\s+/)
    .filter((part) => part && !ARTICLE_RE.test(part))
    .join(' ');

export const levenshteinDistance = (source: string, target: string) => {
  if (source === target) return 0;
  if (!source) return target.length;
  if (!target) return source.length;

  const prev = Array.from({ length: target.length + 1 }, (_, index) => index);
  const next = new Array<number>(target.length + 1).fill(0);

  for (let row = 0; row < source.length; row += 1) {
    next[0] = row + 1;

    for (let col = 0; col < target.length; col += 1) {
      const cost = source[row] === target[col] ? 0 : 1;
      next[col + 1] = Math.min(
        next[col] + 1,
        prev[col + 1] + 1,
        prev[col] + cost
      );
    }

    for (let col = 0; col < prev.length; col += 1) {
      prev[col] = next[col];
    }
  }

  return prev[target.length];
};

export const isMatch = (spoken: string, target: string) => {
  const normalizedSpoken = normalizeEnglishAnswer(spoken);
  const normalizedTarget = normalizeEnglishAnswer(target);

  if (!normalizedSpoken || !normalizedTarget) return false;
  if (normalizedSpoken === normalizedTarget) return true;

  const threshold = normalizedTarget.length <= 6 ? 2 : 3;
  return levenshteinDistance(normalizedSpoken, normalizedTarget) <= threshold;
};
