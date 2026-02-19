-- Add hardStreak counter to track consecutive hard answers
ALTER TABLE "Review"
ADD COLUMN "hardStreak" INTEGER NOT NULL DEFAULT 0;

