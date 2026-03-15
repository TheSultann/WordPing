DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'SessionState'
          AND e.enumlabel = 'QUIZ_ACTIVE'
    ) THEN
        ALTER TYPE "SessionState" ADD VALUE 'QUIZ_ACTIVE';
    END IF;
END
$$;

CREATE TYPE "QuizRunStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED');
CREATE TYPE "QuizQuestionMode" AS ENUM ('MULTIPLE_CHOICE', 'TRUE_FALSE', 'FILL_GAP');
CREATE TYPE "QuizAnswerOutcome" AS ENUM ('CORRECT', 'WRONG', 'SKIPPED');

CREATE TABLE "QuizDailyUsage" (
    "id" SERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "dayStart" TIMESTAMP(3) NOT NULL,
    "startedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuizDailyUsage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuizRun" (
    "id" SERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "status" "QuizRunStatus" NOT NULL DEFAULT 'ACTIVE',
    "totalQuestions" INTEGER NOT NULL,
    "currentIndex" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "wrongCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuizRunItem" (
    "id" SERIAL NOT NULL,
    "runId" INTEGER NOT NULL,
    "questionIndex" INTEGER NOT NULL,
    "wordId" INTEGER NOT NULL,
    "direction" "CardDirection" NOT NULL,
    "mode" "QuizQuestionMode" NOT NULL,
    "promptText" VARCHAR(1024) NOT NULL,
    "options" JSONB,
    "correctAnswer" VARCHAR(256) NOT NULL,
    "correctOptionIndex" INTEGER,
    "selectedAnswer" VARCHAR(256),
    "selectedOptionIndex" INTEGER,
    "outcome" "QuizAnswerOutcome",
    "answerTimeMs" INTEGER,
    "questionSentAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuizRunItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuizDailyUsage_userId_dayStart_key" ON "QuizDailyUsage"("userId", "dayStart");
CREATE INDEX "QuizDailyUsage_dayStart_idx" ON "QuizDailyUsage"("dayStart");

CREATE INDEX "QuizRun_userId_status_idx" ON "QuizRun"("userId", "status");
CREATE INDEX "QuizRun_startedAt_idx" ON "QuizRun"("startedAt");
CREATE INDEX "QuizRun_userId_startedAt_idx" ON "QuizRun"("userId", "startedAt");

CREATE UNIQUE INDEX "QuizRunItem_runId_questionIndex_key" ON "QuizRunItem"("runId", "questionIndex");
CREATE INDEX "QuizRunItem_runId_outcome_idx" ON "QuizRunItem"("runId", "outcome");
CREATE INDEX "QuizRunItem_wordId_idx" ON "QuizRunItem"("wordId");

ALTER TABLE "QuizDailyUsage"
    ADD CONSTRAINT "QuizDailyUsage_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuizRun"
    ADD CONSTRAINT "QuizRun_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuizRunItem"
    ADD CONSTRAINT "QuizRunItem_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "QuizRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
