import { describe, expect, it } from 'vitest';
import {
  quizAccuracy,
  quizAlreadyHandledText,
  quizAnswerToastText,
  quizQuestionKeyboard,
  quizQuestionText,
  quizSummaryText,
} from '../src/bot/quizUi';

const baseQuestion = {
  runId: 12,
  questionId: 34,
  questionIndex: 0,
  totalQuestions: 10,
  expiresAt: new Date('2026-01-01T00:00:00Z'),
} as const;

describe('quiz ui', () => {
  it('escapes non-context prompts and preserves fill-gap html', () => {
    expect(
      quizQuestionText('ru', {
        ...baseQuestion,
        direction: 'EN_TO_RU',
        mode: 'MULTIPLE_CHOICE',
        promptText: '<b>unsafe</b>',
        options: ['safe'],
      })
    ).toContain('📝 &lt;b&gt;unsafe&lt;/b&gt;');

    expect(
      quizQuestionText('uz', {
        ...baseQuestion,
        direction: 'RU_TO_EN',
        mode: 'FILL_GAP',
        promptText: 'A <b>word</b> in context.',
        options: ['word'],
      })
    ).toContain('📝 A <b>word</b> in context.');
  });

  it('builds stable inline keyboard callbacks', () => {
    const keyboard = quizQuestionKeyboard('ru', {
      ...baseQuestion,
      direction: 'EN_TO_RU',
      mode: 'MULTIPLE_CHOICE',
      promptText: 'prompt',
      options: ['one', 'two', 'three'],
    });

    expect(keyboard.reply_markup.inline_keyboard.map((row) => row.map((button) => button.callback_data))).toEqual([
      ['quiz:answer:12:34:0', 'quiz:answer:12:34:1'],
      ['quiz:answer:12:34:2'],
      ['quiz:skip:12:34'],
    ]);
  });

  it('formats summary and accuracy consistently', () => {
    expect(quizAccuracy(7, 10)).toBe(70);
    expect(quizAccuracy(1, 0)).toBe(0);

    const text = quizSummaryText('ru', {
      runId: 12,
      status: 'COMPLETED',
      totalQuestions: 10,
      correctCount: 7,
      wrongCount: 2,
      skippedCount: 1,
      accuracyPercent: 70,
      durationSeconds: 65,
    });

    expect(text).toContain('<b>🧠 Quiz завершён!</b>');
    expect(text).toContain('📊 Результат: <b>7 / 10</b>');
    expect(text).toContain('⏱ Время: <b>1 мин 5 сек</b>');
    expect(text).toContain('🙂 Неплохо, но можно лучше!');
  });

  it('keeps duplicate-answer and toast text stable', () => {
    expect(quizAlreadyHandledText('ru', false)).toBe('Ответ уже принят.');
    expect(quizAlreadyHandledText('uz', true)).toBe('Bu savol allaqachon yopilgan.');

    expect(
      quizAnswerToastText('ru', {
        ok: true,
        duplicate: false,
        stale: false,
        runId: 12,
        questionId: 34,
        outcome: 'WRONG',
        correctAnswer: ' correct ',
        selectedAnswer: 'wrong',
        timedOut: false,
        summary: null,
        nextQuestion: null,
      })
    ).toBe('❌ Неверно. Правильный ответ: correct');
  });
});
