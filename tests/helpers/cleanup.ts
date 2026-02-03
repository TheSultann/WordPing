import { PrismaClient } from '../../src/generated/prisma';

export const cleanupUserData = async (prisma: PrismaClient | undefined, userId: bigint) => {
  if (!prisma) return;
  await prisma.review.deleteMany({ where: { userId } });
  await prisma.word.deleteMany({ where: { userId } });
  await prisma.userSession.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
};
