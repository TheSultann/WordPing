-- Add referral tracking
ALTER TABLE "User" ADD COLUMN "referredById" BIGINT;

CREATE INDEX "User_referredById_idx" ON "User"("referredById");

ALTER TABLE "User"
ADD CONSTRAINT "User_referredById_fkey"
FOREIGN KEY ("referredById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;