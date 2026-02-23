ALTER TABLE "User"
ADD COLUMN "referralQualifiedAt" TIMESTAMP(3);

UPDATE "User"
SET "referralQualifiedAt" = NOW()
WHERE "referredById" IS NOT NULL
  AND "referralQualifiedAt" IS NULL;

CREATE INDEX "User_referredById_referralQualifiedAt_idx"
ON "User"("referredById", "referralQualifiedAt");
