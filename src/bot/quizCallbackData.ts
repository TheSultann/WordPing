export type ParsedQuizCallbackData =
  | {
      action: 'start';
    }
  | {
      action: 'cancel_start';
    }
  | {
      action: 'answer';
      runId: number;
      questionId: number;
      selectedOptionIndex: number;
    }
  | {
      action: 'skip';
      runId: number;
      questionId: number;
    }
  | {
      action: 'next';
      runId: number;
    }
  | {
      action: 'exit';
      runId: number;
    }
  | {
      action: 'invalid';
    }
  | {
      action: 'unknown';
    };

const QUIZ_CALLBACK_PREFIX = 'quiz:';
const QUIZ_CALLBACK_START_PREFIX = `${QUIZ_CALLBACK_PREFIX}start`;
const QUIZ_CALLBACK_CANCEL_START_PREFIX = `${QUIZ_CALLBACK_PREFIX}cancel-start`;
const QUIZ_CALLBACK_ANSWER_PREFIX = `${QUIZ_CALLBACK_PREFIX}answer:`;
const QUIZ_CALLBACK_SKIP_PREFIX = `${QUIZ_CALLBACK_PREFIX}skip:`;
const QUIZ_CALLBACK_NEXT_PREFIX = `${QUIZ_CALLBACK_PREFIX}next:`;
const QUIZ_CALLBACK_EXIT_PREFIX = `${QUIZ_CALLBACK_PREFIX}exit:`;

const parsePositiveInt = (value: string | undefined): number | null => {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

const parseNonNegativeInt = (value: string | undefined): number | null => {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
};

export const isQuizCallbackData = (data: string): boolean => data.startsWith(QUIZ_CALLBACK_PREFIX);

export const quizStartCallback = () => QUIZ_CALLBACK_START_PREFIX;

export const quizCancelStartCallback = () => QUIZ_CALLBACK_CANCEL_START_PREFIX;

export const quizAnswerCallback = (runId: number, questionId: number, optionIndex: number) =>
  `${QUIZ_CALLBACK_ANSWER_PREFIX}${runId}:${questionId}:${optionIndex}`;

export const quizSkipCallback = (runId: number, questionId: number) =>
  `${QUIZ_CALLBACK_SKIP_PREFIX}${runId}:${questionId}`;

export const quizNextCallback = (runId: number) => `${QUIZ_CALLBACK_NEXT_PREFIX}${runId}`;

export const quizExitCallback = (runId: number) => `${QUIZ_CALLBACK_EXIT_PREFIX}${runId}`;

export const parseQuizCallbackData = (data: string): ParsedQuizCallbackData | null => {
  if (!isQuizCallbackData(data)) return null;

  const parts = data.split(':');
  const action = parts[1] ?? '';

  switch (action) {
    case 'start':
      return { action: 'start' };
    case 'cancel-start':
      return { action: 'cancel_start' };
    case 'answer': {
      const runId = parsePositiveInt(parts[2]);
      const questionId = parsePositiveInt(parts[3]);
      const selectedOptionIndex = parseNonNegativeInt(parts[4]);
      if (!runId || !questionId || selectedOptionIndex === null) {
        return { action: 'invalid' };
      }
      return { action: 'answer', runId, questionId, selectedOptionIndex };
    }
    case 'skip': {
      const runId = parsePositiveInt(parts[2]);
      const questionId = parsePositiveInt(parts[3]);
      if (!runId || !questionId) {
        return { action: 'invalid' };
      }
      return { action: 'skip', runId, questionId };
    }
    case 'next': {
      const runId = parsePositiveInt(parts[2]);
      if (!runId) {
        return { action: 'invalid' };
      }
      return { action: 'next', runId };
    }
    case 'exit': {
      const runId = parsePositiveInt(parts[2]);
      if (!runId) {
        return { action: 'invalid' };
      }
      return { action: 'exit', runId };
    }
    default:
      return { action: 'unknown' };
  }
};
