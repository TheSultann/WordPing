ALTER TABLE "Review"
ADD COLUMN IF NOT EXISTS "direction" "CardDirection";

UPDATE "Review"
SET "direction" = 'EN_TO_RU'
WHERE "direction" IS NULL;

DROP INDEX IF EXISTS "Review_wordId_key";
DROP INDEX IF EXISTS "Review_userId_nextReviewAt_idx";

INSERT INTO "Review" (
  "userId",
  "wordId",
  "direction",
  "hardStreak",
  "lastReviewAt",
  "nextReviewAt",
  "stage",
  "intervalMinutes",
  "easeFactor",
  "lastDirection",
  "lastAnswerText",
  "lastResult",
  "createdAt",
  "updatedAt"
)
SELECT
  r."userId",
  r."wordId",
  'RU_TO_EN',
  0,
  NULL,
  r."nextReviewAt",
  r."stage",
  r."intervalMinutes",
  r."easeFactor",
  NULL,
  NULL,
  NULL,
  r."createdAt",
  r."updatedAt"
FROM "Review" r
WHERE r."direction" = 'EN_TO_RU'
  AND NOT EXISTS (
    SELECT 1
    FROM "Review" x
    WHERE x."wordId" = r."wordId"
      AND x."direction" = 'RU_TO_EN'
  );

ALTER TABLE "Review"
ALTER COLUMN "direction" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Review_wordId_direction_key"
ON "Review"("wordId", "direction");

CREATE INDEX IF NOT EXISTS "Review_userId_direction_nextReviewAt_idx"
ON "Review"("userId", "direction", "nextReviewAt");
