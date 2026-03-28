import type { PrismaClient } from '../../src/generated/prisma';

type CleanupPrisma = Pick<PrismaClient, 'review' | 'word' | 'userSession' | 'user'>;

export const cleanupUserData = async (prisma: CleanupPrisma | undefined, userId: bigint) => {
  if (!prisma) return;
  await prisma.review.deleteMany({ where: { userId } });
  await prisma.word.deleteMany({ where: { userId } });
  await prisma.userSession.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
};
