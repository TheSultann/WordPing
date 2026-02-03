-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "DirectionMode" AS ENUM ('MIXED', 'EN_TO_RU', 'RU_TO_EN');

-- CreateEnum
CREATE TYPE "CardDirection" AS ENUM ('EN_TO_RU', 'RU_TO_EN');

-- CreateEnum
CREATE TYPE "ReviewResult" AS ENUM ('CORRECT', 'INCORRECT', 'SKIPPED');

-- CreateEnum
CREATE TYPE "SessionState" AS ENUM ('IDLE', 'ADDING_WORD_WAIT_EN', 'ADDING_WORD_CONFIRM_TRANSLATION', 'ADDING_WORD_WAIT_RU_MANUAL', 'WAITING_ANSWER', 'WAITING_GRADE');

-- CreateTable
CREATE TABLE "User" (
    "id" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timezone" VARCHAR(64),
    "directionMode" "DirectionMode" NOT NULL DEFAULT 'MIXED',
    "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "windowStartMinutes" INTEGER NOT NULL DEFAULT 480,
    "windowEndMinutes" INTEGER NOT NULL DEFAULT 1380,
    "dailyGoal" INTEGER NOT NULL DEFAULT 5,
    "streakCount" INTEGER NOT NULL DEFAULT 0,
    "lastStreakDate" TIMESTAMP(3),
    "todayCompleted" INTEGER NOT NULL DEFAULT 0,
    "todayDate" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Word" (
    "id" SERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "wordEn" VARCHAR(256) NOT NULL,
    "translationRu" VARCHAR(256) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Word_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" SERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "wordId" INTEGER NOT NULL,
    "lastReviewAt" TIMESTAMP(3),
    "nextReviewAt" TIMESTAMP(3),
    "stage" INTEGER NOT NULL DEFAULT 0,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 0,
    "easeFactor" DOUBLE PRECISION DEFAULT 2.3,
    "lastDirection" "CardDirection",
    "lastAnswerText" TEXT,
    "lastResult" "ReviewResult",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "userId" BIGINT NOT NULL,
    "state" "SessionState" NOT NULL DEFAULT 'IDLE',
    "reviewId" INTEGER,
    "wordId" INTEGER,
    "direction" "CardDirection",
    "sentAt" TIMESTAMP(3),
    "reminderStep" INTEGER NOT NULL DEFAULT 0,
    "answerText" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "Word_userId_idx" ON "Word"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Word_userId_wordEn_key" ON "Word"("userId", "wordEn");

-- CreateIndex
CREATE UNIQUE INDEX "Review_wordId_key" ON "Review"("wordId");

-- CreateIndex
CREATE INDEX "Review_userId_nextReviewAt_idx" ON "Review"("userId", "nextReviewAt");

-- CreateIndex
CREATE INDEX "Review_wordId_idx" ON "Review"("wordId");

-- CreateIndex
CREATE INDEX "UserSession_state_idx" ON "UserSession"("state");

-- AddForeignKey
ALTER TABLE "Word" ADD CONSTRAINT "Word_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

