import { describe, expect, it } from 'vitest';
import { buildHintMaskByPress, isHintAvailable } from '../src/utils/hint';

describe('hint utils', () => {
  it('reveals letters in the configured order across 4 presses', () => {
    expect(buildHintMaskByPress('apple', 1)).toBe('a____');
    expect(buildHintMaskByPress('apple', 2)).toBe('ap___');
    expect(buildHintMaskByPress('apple', 3)).toBe('ap__e');
    expect(buildHintMaskByPress('apple', 4)).toBe('app_e');
  });

  it('requires more than 3 visible characters for a hint', () => {
    expect(isHintAvailable('go')).toBe(false);
    expect(isHintAvailable('word')).toBe(true);
  });
});
