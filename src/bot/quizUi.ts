import { Markup } from 'telegraf';
import type { Lang } from '../i18n';
import {
  QUIZ_TIME_LIMIT_SECONDS,
  type QuizQuestionView,
  type QuizSummary,
  type SubmitQuizAnswerResult,
} from '../services/quizService';
import { escapeHtml } from '../utils/html';
import { quizAnswerCallback, quizSkipCallback } from './quizCallbackData';

const quizTaskLabel = (lang: Lang, question: QuizQuestionView): string => {
  if (question.mode === 'TRUE_FALSE') {
    return lang === 'uz' ? 'Moslik to‘g‘rimi?' : 'Верно ли соответствие?';
  }
  if (question.mode === 'FILL_GAP') {
    if (question.direction === 'EN_TO_RU') {
      return lang === 'uz' ? 'Tarjimani tanlang:' : 'Выберите перевод:';
    }
    return lang === 'uz' ? 'Qaysi inglizcha so‘z mazmunga mos keladi?' : 'Какое английское слово подходит по смыслу?';
  }
  if (question.direction === 'EN_TO_RU') {
    return lang === 'uz' ? 'Tarjimani tanlang:' : 'Выберите перевод:';
  }
  return lang === 'uz' ? 'Inglizcha so‘zni tanlang:' : 'Выбери английское слово:';
};

export const quizQuestionText = (lang: Lang, question: QuizQuestionView): string => {
  const questionNumber = question.questionIndex + 1;
  const taskLabel = quizTaskLabel(lang, question).replace(/[:：]\s*$/, '');
  const promptText = question.mode === 'FILL_GAP' ? question.promptText : escapeHtml(question.promptText);
  const lines = [
    `🧠 ${questionNumber}/${question.totalQuestions} · ⏱ ${QUIZ_TIME_LIMIT_SECONDS}${lang === 'uz' ? 's' : 'с'}`,
    '',
    `📝 ${promptText}`,
    '',
    `${escapeHtml(taskLabel)} 👇`,
  ];
  return lines.join('\n');
};

export const quizQuestionKeyboard = (lang: Lang, question: QuizQuestionView) => {
  const rows: Array<Array<ReturnType<typeof Markup.button.callback>>> = [];
  if (question.mode === 'TRUE_FALSE') {
    rows.push([
      Markup.button.callback(lang === 'uz' ? '✅ To‘g‘ri' : '✅ Верно', quizAnswerCallback(question.runId, question.questionId, 0)),
      Markup.button.callback(lang === 'uz' ? '❌ Noto‘g‘ri' : '❌ Неверно', quizAnswerCallback(question.runId, question.questionId, 1)),
    ]);
  } else {
    const options = question.options ?? [];
    for (let index = 0; index < options.length; index += 2) {
      const left = options[index];
      const right = options[index + 1];
      const row: Array<ReturnType<typeof Markup.button.callback>> = [];
      if (left) {
        row.push(Markup.button.callback(left, quizAnswerCallback(question.runId, question.questionId, index)));
      }
      if (right) {
        row.push(Markup.button.callback(right, quizAnswerCallback(question.runId, question.questionId, index + 1)));
      }
      if (row.length) rows.push(row);
    }
  }

  rows.push([
    {
      ...Markup.button.callback(
        lang === 'uz' ? '⏭ O‘tkazish' : '⏭ Пропуск',
        quizSkipCallback(question.runId, question.questionId),
      ),
      style: 'success',
    } as ReturnType<typeof Markup.button.callback>,
  ]);
  return Markup.inlineKeyboard(rows);
};

export const quizAccuracy = (correctCount: number, totalQuestions: number): number => {
  if (!Number.isFinite(totalQuestions) || totalQuestions <= 0) return 0;
  return Math.round((correctCount / totalQuestions) * 100);
};

const formatQuizDuration = (lang: Lang, durationSeconds: number | null): string => {
  if (!Number.isFinite(durationSeconds) || durationSeconds === null || durationSeconds < 0) {
    return '-';
  }

  const totalSeconds = Math.max(0, Math.round(durationSeconds));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (lang === 'uz') {
    if (minutes <= 0) return `${seconds} sek`;
    return `${minutes} min ${seconds} sek`;
  }

  if (minutes <= 0) return `${seconds} сек`;
  return `${minutes} мин ${seconds} сек`;
};

const quizSummaryMoodText = (lang: Lang, accuracyPercent: number): string => {
  if (lang === 'uz') {
    if (accuracyPercent >= 85) return '🔥 Juda zo‘r natija!';
    if (accuracyPercent >= 60) return '🙂 Yaxshi, yana ham yaxshiroq bo‘lishi mumkin!';
    return '😅 Hali ishlash kerak!';
  }

  if (accuracyPercent >= 85) return '🔥 Отличный результат!';
  if (accuracyPercent >= 60) return '🙂 Неплохо, но можно лучше!';
  return '😅 Есть над чем поработать!';
};

export const quizSummaryText = (lang: Lang, summary: QuizSummary): string => {
  const title = lang === 'uz' ? '🧠 Quiz yakunlandi!' : '🧠 Quiz завершён!';
  const durationLabel = formatQuizDuration(lang, summary.durationSeconds);
  const moodText = quizSummaryMoodText(lang, summary.accuracyPercent);

  return [
    `<b>${title}</b>`,
    '',
    `${lang === 'uz' ? '📊 Natija' : '📊 Результат'}: <b>${summary.correctCount} / ${summary.totalQuestions}</b>`,
    `${lang === 'uz' ? '🎯 Aniqlik' : '🎯 Точность'}: <b>${summary.accuracyPercent}%</b>`,
    '',
    `${lang === 'uz' ? '✅ To‘g‘ri' : '✅ Верно'}: <b>${summary.correctCount}</b>`,
    `${lang === 'uz' ? '❌ Xatolar' : '❌ Ошибок'}: <b>${summary.wrongCount}</b>`,
    `${lang === 'uz' ? '⏭ O‘tkazib yuborildi' : '⏭ Пропусков'}: <b>${summary.skippedCount}</b>`,
    `${lang === 'uz' ? '⏱ Vaqt' : '⏱ Время'}: <b>${durationLabel}</b>`,
    '',
    moodText,
  ].join('\n');
};

export const quizAlreadyHandledText = (lang: Lang, stale: boolean): string => {
  if (stale) return lang === 'uz' ? 'Bu savol allaqachon yopilgan.' : 'Этот вопрос уже закрыт.';
  return lang === 'uz' ? 'Javob allaqachon qabul qilingan.' : 'Ответ уже принят.';
};

export const quizAnswerToastText = (
  lang: Lang,
  result: Extract<SubmitQuizAnswerResult, { ok: true }>
): string => {
  if (result.outcome === 'CORRECT') {
    return lang === 'uz' ? '✅ To‘g‘ri' : '✅ Верно';
  }

  if (result.outcome === 'WRONG') {
    const answer = result.correctAnswer.trim();
    return lang === 'uz'
      ? `❌ Noto‘g‘ri. To‘g‘ri javob: ${answer}`.slice(0, 180)
      : `❌ Неверно. Правильный ответ: ${answer}`.slice(0, 180);
  }

  if (result.timedOut) {
    return lang === 'uz' ? '⏱ Vaqt tugadi' : '⏱ Время вышло';
  }

  return lang === 'uz' ? '⏭ O‘tkazildi' : '⏭ Пропуск';
};
