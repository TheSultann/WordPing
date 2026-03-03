-- DropColumn (legacy fields removed in bug #9)
ALTER TABLE "User" DROP COLUMN IF EXISTS "todayCompleted",
DROP COLUMN IF EXISTS "todayDate",
DROP COLUMN IF EXISTS "windowStartMinutes",
DROP COLUMN IF EXISTS "windowEndMinutes";

-- AlterTable
ALTER TABLE "Word" ADD COLUMN IF NOT EXISTS "exampleSentences" JSONB,
ADD COLUMN IF NOT EXISTS "sentenceIndex" INTEGER NOT NULL DEFAULT 0;
