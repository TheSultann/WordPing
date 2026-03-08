import { describe, expect, it } from 'vitest';
import { blankTargetInSentence, highlightTargetInSentence } from '../src/utils/reviewCardText';

describe('review card text utils', () => {
  it('highlights exact match', () => {
    const result = highlightTargetInSentence('Every choice has some drawbacks, sadly.', 'drawbacks');
    expect(result).toContain('<u><b>drawbacks</b></u>');
  });

  it('highlights russian inflected phrase when exact form is absent', () => {
    const result = highlightTargetInSentence('Пяти долларов должно хватить на обед.', 'пять долларов');
    expect(result).toContain('<u><b>Пяти долларов</b></u>');
  });

  it('highlights adjective+noun russian inflected phrase', () => {
    const result = highlightTargetInSentence('Алмазы считаются драгоценным камнем.', 'драгоценный камень');
    expect(result).toContain('<u><b>драгоценным камнем</b></u>');
  });

  it('blanks russian inflected phrase', () => {
    const result = blankTargetInSentence('Пяти долларов должно хватить на обед.', 'пять долларов');
    expect(result).toBe('___ должно хватить на обед.');
  });

  it('keeps html safe', () => {
    const result = highlightTargetInSentence('5 < 6 & true', '5');
    expect(result).toBe('<u><b>5</b></u> &lt; 6 &amp; true');
  });

  it('blanks all exact target occurrences', () => {
    const result = blankTargetInSentence('Economy drives economy and ECONOMY.', 'economy');
    expect(result).toBe('___ drives ___ and ___.');
  });
});
