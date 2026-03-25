import { describe, expect, it } from 'vitest';
import { answersEqual, normalizeAnswer } from '../src/utils/text';

describe('text russian normalization', () => {
  it('treats е and ё as the same letter', () => {
    expect(answersEqual('ёж', 'еж')).toBe(true);
    expect(normalizeAnswer('Ёлка')).toBe('елка');
  });
});
