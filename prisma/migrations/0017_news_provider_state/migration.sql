DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'NewsProvider'
      AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE "NewsProvider" AS ENUM ('NEWSDATA', 'GDELT', 'GUARDIAN');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'NewsExampleTier'
      AND e.enumlabel = 'NEWSDATA'
      AND n.nspname = current_schema()
  ) THEN
    ALTER TYPE "NewsExampleTier" ADD VALUE 'NEWSDATA';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "NewsProviderState" (
  "provider" "NewsProvider" NOT NULL,
  "dayStartUtc" TIMESTAMP(3) NOT NULL,
  "requestsToday" INTEGER NOT NULL DEFAULT 0,
  "lastRequestAt" TIMESTAMP(3),
  "cooldownUntil" TIMESTAMP(3),
  "lastStatusCode" INTEGER,
  "lastError" VARCHAR(512),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NewsProviderState_pkey" PRIMARY KEY ("provider")
);

CREATE INDEX IF NOT EXISTS "NewsProviderState_cooldownUntil_idx"
  ON "NewsProviderState"("cooldownUntil");

CREATE INDEX IF NOT EXISTS "NewsProviderState_dayStartUtc_idx"
  ON "NewsProviderState"("dayStartUtc");