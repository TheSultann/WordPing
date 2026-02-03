export const normalizeWhitespace = (text: string): string => text.replace(/\s+/g, ' ').trim();

export const normalizeBasic = (text: string): string => normalizeWhitespace(text).toLowerCase();

const stripArticles = (text: string): string => text.replace(/^(a|an|the)\s+/i, '');

const stripTrailingPunctuation = (text: string): string => text.replace(/[.,!?:;]+$/g, '');

export const normalizeAnswer = (text: string): string => {
  return stripTrailingPunctuation(normalizeBasic(text));
};

export const normalizeEnglish = (text: string): string => {
  const cleaned = normalizeAnswer(text);
  return stripArticles(cleaned);
};

export const answersEqual = (expected: string, actual: string): boolean => {
  return normalizeAnswer(expected) === normalizeAnswer(actual);
};

export const answersEqualEnglish = (expected: string, actual: string): boolean => {
  return normalizeEnglish(expected) === normalizeEnglish(actual);
};
