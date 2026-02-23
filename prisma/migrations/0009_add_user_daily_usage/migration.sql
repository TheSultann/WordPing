-- Track daily auto-translation API usage per user
CREATE TABLE "UserDailyUsage" (
  "id" SERIAL NOT NULL,
  "userId" BIGINT NOT NULL,
  "dayStart" TIMESTAMP(3) NOT NULL,
  "autoTranslateCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserDailyUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserDailyUsage_userId_dayStart_key" ON "UserDailyUsage"("userId", "dayStart");
CREATE INDEX "UserDailyUsage_dayStart_idx" ON "UserDailyUsage"("dayStart");

ALTER TABLE "UserDailyUsage"
ADD CONSTRAINT "UserDailyUsage_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
