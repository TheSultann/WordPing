import { describe, expect, it } from 'vitest';
import { checkAnswer } from '../src/services/answerChecker';

describe('answerChecker', () => {
  it('accepts English answer with articles for RU_TO_EN', () => {
    const result = checkAnswer('RU_TO_EN', 'apple', 'яблоко', 'the apple');
    expect(result.correct).toBe(true);
  });

  it('rejects wrong English answer for RU_TO_EN', () => {
    const result = checkAnswer('RU_TO_EN', 'apple', 'яблоко', 'orange');
    expect(result.correct).toBe(false);
  });

  it('checks Russian answer for EN_TO_RU', () => {
    const result = checkAnswer('EN_TO_RU', 'apple', 'яблоко', '  Яблоко ');
    expect(result.correct).toBe(true);
  });
});
