import { describe, expect, it } from 'vitest';
import {
  isQuizCallbackData,
  parseQuizCallbackData,
  quizAnswerCallback,
  quizCancelStartCallback,
  quizExitCallback,
  quizNextCallback,
  quizSkipCallback,
  quizStartCallback,
} from '../src/bot/quizCallbackData';

describe('quiz callback data', () => {
  it('builds stable callback strings', () => {
    expect(quizStartCallback()).toBe('quiz:start');
    expect(quizCancelStartCallback()).toBe('quiz:cancel-start');
    expect(quizAnswerCallback(12, 34, 1)).toBe('quiz:answer:12:34:1');
    expect(quizSkipCallback(12, 34)).toBe('quiz:skip:12:34');
    expect(quizNextCallback(12)).toBe('quiz:next:12');
    expect(quizExitCallback(12)).toBe('quiz:exit:12');
  });

  it('parses supported callback actions', () => {
    expect(parseQuizCallbackData('quiz:start')).toEqual({
      action: 'start',
    });
    expect(parseQuizCallbackData('quiz:cancel-start')).toEqual({
      action: 'cancel_start',
    });
    expect(parseQuizCallbackData('quiz:answer:12:34:1')).toEqual({
      action: 'answer',
      runId: 12,
      questionId: 34,
      selectedOptionIndex: 1,
    });
    expect(parseQuizCallbackData('quiz:skip:12:34')).toEqual({
      action: 'skip',
      runId: 12,
      questionId: 34,
    });
    expect(parseQuizCallbackData('quiz:next:12')).toEqual({
      action: 'next',
      runId: 12,
    });
    expect(parseQuizCallbackData('quiz:exit:12')).toEqual({
      action: 'exit',
      runId: 12,
    });
  });

  it('preserves invalid vs unknown callback handling', () => {
    expect(parseQuizCallbackData('quiz:answer:12:34')).toEqual({ action: 'invalid' });
    expect(parseQuizCallbackData('quiz:next:nope')).toEqual({ action: 'invalid' });
    expect(parseQuizCallbackData('quiz:wat:12')).toEqual({ action: 'unknown' });
    expect(parseQuizCallbackData('hint:12')).toBeNull();
    expect(isQuizCallbackData('quiz:answer:1:2:3')).toBe(true);
    expect(isQuizCallbackData('hint:12')).toBe(false);
  });
});
