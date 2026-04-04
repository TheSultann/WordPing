ALTER TABLE "Review"
ADD COLUMN IF NOT EXISTS "initialAutoReviewPending" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "Review_userId_initialAutoReviewPending_nextReviewAt_idx"
ON "Review"("userId", "initialAutoReviewPending", "nextReviewAt");
