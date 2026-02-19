import { CardDirection, SessionState, UserSession } from '../generated/prisma/client';
import { prisma } from '../db/client';

export type SessionData = {
  reviewId?: number | null;
  wordId?: number | null;
  direction?: CardDirection | null;
  sentAt?: Date | null;
  reminderStep?: number;
  answerText?: string | null;
  payload?: Record<string, unknown> | null;
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
  const existingLang = (existing?.payload as any)?.lang;
  const rawPayload = (data.payload ?? null) as any;
  const lang = rawPayload?.lang ?? existingLang ?? null;
  const payload = lang ? { ...rawPayload, lang } : rawPayload;
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
      payload: (payload ?? null) as any,
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
      payload: (payload ?? null) as any,
    },
  });
};

export const setSessionActiveIfIdle = async (
  userId: bigint,
  state: SessionState,
  data: SessionData = {}
): Promise<boolean> => {
  const existing = await prisma.userSession.findUnique({ where: { userId } });
  const lang = (existing?.payload as any)?.lang;
  const rawPayload = (data.payload ?? null) as any;
  const payload = lang ? { ...rawPayload, lang } : rawPayload;
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
      payload: (payload ?? null) as any,
      updatedAt: new Date(),
    },
  });
  return result.count > 0;
};

export const resetState = async (userId: bigint) => {
  const existing = await prisma.userSession.findUnique({ where: { userId } });
  const lang = (existing?.payload as any)?.lang;
  const payload = lang ? { lang } : null;
  return setState(userId, 'IDLE', { payload });
};

