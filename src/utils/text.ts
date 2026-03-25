export const normalizeWhitespace = (text: string): string => text.replace(/\s+/g, ' ').trim();

const normalizeRussianVariants = (text: string): string => text.replace(/ё/gu, 'е');
const normalizeUnicode = (text: string): string => text.normalize('NFKC');

export const normalizeBasic = (text: string): string =>
  normalizeRussianVariants(normalizeWhitespace(text).toLowerCase());

export const normalizeWordLookup = (text: string): string =>
  normalizeWhitespace(normalizeUnicode(text)).toLocaleLowerCase('en-US');

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
