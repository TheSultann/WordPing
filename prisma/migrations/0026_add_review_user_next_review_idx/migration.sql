CREATE INDEX IF NOT EXISTS "Review_userId_nextReviewAt_idx"
ON "Review"("userId", "nextReviewAt");
