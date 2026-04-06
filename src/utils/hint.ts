/**
 * Shared hint-masking utilities used by both bot and worker.
 */

const HINT_SEPARATOR_RE = /[\s'`\u2019-]/u;

export const isHintAvailable = (value: string): boolean =>
  Array.from(value.trim()).filter((char) => !HINT_SEPARATOR_RE.test(char)).length > 3;

export const buildMaskedHint = (value: string, revealIndexes: number[]): string | null => {
  const chars = Array.from(value);
  if (!chars.length) return null;

  const reveal = new Set<number>();
  for (const index of revealIndexes) {
    if (index >= 0 && index < chars.length) reveal.add(index);
  }

  return chars
    .map((char, index) => {
      if (reveal.has(index)) return char;
      if (HINT_SEPARATOR_RE.test(char)) return char;
      return '_';
    })
    .join('');
};

export const buildHintMaskByPress = (value: string, press: number): string | null => {
  const chars = Array.from(value.trim());
  if (!isHintAvailable(value)) return null;
  if (!chars.length) return null;
  const reveal = [0];
  if (press >= 2 && chars.length > 1) reveal.push(1);
  if (press >= 3 && chars.length > 2) reveal.push(chars.length - 1);
  if (press >= 4 && chars.length > 3) reveal.push(2);
  return buildMaskedHint(value.trim(), reveal);
};
