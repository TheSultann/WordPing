import { describe, expect, it } from 'vitest';
import {
  normalizeWhitespace,
  normalizeAnswer,
  normalizeEnglish,
  answersEqual,
  answersEqualEnglish,
} from '../src/utils/text';

describe('text utils', () => {
  it('normalizeWhitespace collapses spaces', () => {
    expect(normalizeWhitespace('  hello\n  world\t ')).toBe('hello world');
  });

  it('normalizeAnswer trims, lowercases, strips trailing punctuation', () => {
    expect(normalizeAnswer('  HeLLo!!! ')).toBe('hello');
    expect(normalizeAnswer('test?')).toBe('test');
  });

  it('normalizeEnglish strips leading articles', () => {
    expect(normalizeEnglish('The Apple')).toBe('apple');
    expect(normalizeEnglish('an orange')).toBe('orange');
    expect(normalizeEnglish('a banana')).toBe('banana');
  });

  it('answersEqual ignores case and whitespace', () => {
    expect(answersEqual('  Привет', 'привет  ')).toBe(true);
  });

  it('answersEqualEnglish ignores articles and punctuation', () => {
    expect(answersEqualEnglish('apple', 'the apple')).toBe(true);
    expect(answersEqualEnglish('orange', 'An orange.')).toBe(true);
  });
});
