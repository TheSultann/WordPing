import { describe, expect, it } from 'vitest';
import {
  asQuizPayloadRecord,
  parseQuizMessageRefFromPayload,
  parseQuizQuestionIdFromPayload,
  parseQuizRunIdFromPayload,
  parseQuizServiceMessageRefFromPayload,
} from '../src/bot/quizPayload';

describe('quiz payload', () => {
  it('parses run and question ids', () => {
    const payload = { quizRunId: 12, quizQuestionId: 34 };
    expect(parseQuizRunIdFromPayload(payload)).toBe(12);
    expect(parseQuizQuestionIdFromPayload(payload)).toBe(34);
  });

  it('parses message refs', () => {
    const payload = {
      quizChatId: 100,
      quizMessageId: 200,
      quizServiceChatId: 101,
      quizServiceMessageId: 201,
    };
    expect(parseQuizMessageRefFromPayload(payload)).toEqual({ chatId: 100, messageId: 200 });
    expect(parseQuizServiceMessageRefFromPayload(payload)).toEqual({ chatId: 101, messageId: 201 });
  });

  it('rejects invalid payloads', () => {
    expect(asQuizPayloadRecord(null)).toBeNull();
    expect(parseQuizRunIdFromPayload({ quizRunId: 0 })).toBeNull();
    expect(parseQuizQuestionIdFromPayload({ quizQuestionId: -1 })).toBeNull();
    expect(parseQuizMessageRefFromPayload({ quizChatId: 1, quizMessageId: 0 })).toBeNull();
    expect(parseQuizServiceMessageRefFromPayload({ quizServiceChatId: '1', quizServiceMessageId: 2 })).toBeNull();
  });
});
