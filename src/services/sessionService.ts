import { CardDirection, Prisma, SessionState, UserSession } from '../generated/prisma/client';
import { prisma } from '../db/client';

/** Shape stored in session.payload JSON column. */
export interface SessionPayload {
  lang?: string | null;
  correct?: boolean;
  wordEn?: string;
  translationRu?: string;
  cardBaseText?: string;
  hintTarget?: string;
  hintPresses?: number;
  hintReviewId?: number;
  swapData?: string | null;
  hintInline?: boolean;
  manualField?: string;
  sourceNative?: string;
  swaps?: Record<string, string>;
  newsDigest?: Record<string, unknown>;
  onboarding?: { lang?: string; step?: string } | null;
  [key: string]: unknown;
}

/** Safely narrow Prisma JsonValue to SessionPayload. */
export const asPayload = (value: Prisma.JsonValue | null | undefined): SessionPayload | null => {
  if (value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)) {
    return value as unknown as SessionPayload;
  }
  return null;
};

export type SessionData = {
  reviewId?: number | null;
  wordId?: number | null;
  direction?: CardDirection | null;
  sentAt?: Date | null;
  reminderStep?: number;
  answerText?: string | null;
  payload?: SessionPayload | null;
};

export const ensureSession = async (userId: bigint): Promise<UserSession> => {
  return prisma.userSession.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
};

export const getSession = async (userId: bigint): Promise<UserSession> => {
  return ensureSession(userId);
};

export const setState = async (
  userId: bigint,
  state: SessionState,
  data: SessionData = {}
): Promise<UserSession> => {
  const existing = await prisma.userSession.findUnique({ where: { userId } });
  const existingLang = asPayload(existing?.payload)?.lang;
  const rawPayload = data.payload ?? null;
  const lang = rawPayload?.lang ?? existingLang ?? null;
  const payload = (lang
    ? { ...rawPayload, lang }
    : rawPayload) as Prisma.InputJsonValue | null;
  return prisma.userSession.upsert({
    where: { userId },
    update: {
      state,
      reviewId: data.reviewId ?? null,
      wordId: data.wordId ?? null,
      direction: data.direction ?? null,
      sentAt: data.sentAt ?? null,
      reminderStep: data.reminderStep ?? 0,
      answerText: data.answerText ?? null,
      payload: payload ?? Prisma.DbNull,
    },
    create: {
      userId,
      state,
      reviewId: data.reviewId ?? null,
      wordId: data.wordId ?? null,
      direction: data.direction ?? null,
      sentAt: data.sentAt ?? null,
      reminderStep: data.reminderStep ?? 0,
      answerText: data.answerText ?? null,
      payload: payload ?? Prisma.DbNull,
    },
  });
};

export const setSessionActiveIfIdle = async (
  userId: bigint,
  state: SessionState,
  data: SessionData = {}
): Promise<boolean> => {
  const existing = await prisma.userSession.findUnique({ where: { userId } });
  const lang = asPayload(existing?.payload)?.lang;
  const rawPayload = data.payload ?? null;
  const payload = (lang
    ? { ...rawPayload, lang }
    : rawPayload) as Prisma.InputJsonValue | null;
  const result = await prisma.userSession.updateMany({
    where: {
      userId,
      state: 'IDLE',
    },
    data: {
      state,
      reviewId: data.reviewId ?? null,
      wordId: data.wordId ?? null,
      direction: data.direction ?? null,
      sentAt: data.sentAt ?? null,
      reminderStep: data.reminderStep ?? 0,
      answerText: data.answerText ?? null,
      payload: payload ?? Prisma.DbNull,
      updatedAt: new Date(),
    },
  });
  return result.count > 0;
};

export const resetState = async (userId: bigint) => {
  const existing = await prisma.userSession.findUnique({ where: { userId } });
  const lang = asPayload(existing?.payload)?.lang;
  const payload: SessionPayload | null = lang ? { lang } : null;
  return setState(userId, 'IDLE', { payload });
};

