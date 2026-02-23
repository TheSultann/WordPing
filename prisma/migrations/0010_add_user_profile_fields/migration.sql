ALTER TABLE "User"
ADD COLUMN "tgUsername" VARCHAR(64),
ADD COLUMN "tgFirstName" VARCHAR(128),
ADD COLUMN "tgLastName" VARCHAR(128),
ADD COLUMN "tgDisplayName" VARCHAR(191),
ADD COLUMN "lastSeenAt" TIMESTAMP(3);

CREATE INDEX "User_tgUsername_idx" ON "User"("tgUsername");
CREATE INDEX "User_lastSeenAt_idx" ON "User"("lastSeenAt");
