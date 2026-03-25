export type QuizMessageRef = {
  chatId: number;
  messageId: number;
};

export const asQuizPayloadRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export const parseQuizRunIdFromPayload = (value: unknown): number | null => {
  const payload = asQuizPayloadRecord(value);
  if (!payload) return null;
  const runId = payload.quizRunId;
  if (typeof runId !== 'number' || !Number.isFinite(runId) || runId <= 0) return null;
  return Math.floor(runId);
};

export const parseQuizQuestionIdFromPayload = (value: unknown): number | null => {
  const payload = asQuizPayloadRecord(value);
  if (!payload) return null;
  const questionId = payload.quizQuestionId;
  if (typeof questionId !== 'number' || !Number.isFinite(questionId) || questionId <= 0) return null;
  return Math.floor(questionId);
};

export const parseQuizMessageRefFromPayload = (value: unknown): QuizMessageRef | null => {
  const payload = asQuizPayloadRecord(value);
  if (!payload) return null;
  const chatId = payload.quizChatId;
  const messageId = payload.quizMessageId;
  if (typeof chatId !== 'number' || !Number.isFinite(chatId)) return null;
  if (typeof messageId !== 'number' || !Number.isFinite(messageId) || messageId <= 0) return null;
  return {
    chatId,
    messageId: Math.floor(messageId),
  };
};

export const parseQuizServiceMessageRefFromPayload = (value: unknown): QuizMessageRef | null => {
  const payload = asQuizPayloadRecord(value);
  if (!payload) return null;
  const chatId = payload.quizServiceChatId;
  const messageId = payload.quizServiceMessageId;
  if (typeof chatId !== 'number' || !Number.isFinite(chatId)) return null;
  if (typeof messageId !== 'number' || !Number.isFinite(messageId) || messageId <= 0) return null;
  return {
    chatId,
    messageId: Math.floor(messageId),
  };
};
