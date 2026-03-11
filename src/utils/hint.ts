/**
 * Shared hint-masking utilities used by both bot and worker.
 */

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
      if (/\s|[''`-]/.test(char)) return char;
      return '_';
    })
    .join('');
};

export const buildHintMaskByPress = (value: string, press: number): string | null => {
  const chars = Array.from(value.trim());
  if (!chars.length) return null;
  const reveal = [0];
  if (press >= 2 && chars.length > 1) reveal.push(chars.length - 1);
  if (press >= 3 && chars.length > 2) reveal.push(1);
  return buildMaskedHint(value.trim(), reveal);
};
