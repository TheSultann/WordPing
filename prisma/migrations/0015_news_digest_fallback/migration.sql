DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'NewsExampleTier'
      AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE "NewsExampleTier" AS ENUM ('CACHE', 'GDELT', 'AI');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'NewsResolveJobStatus'
      AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE "NewsResolveJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');
  END IF;
END $$;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "newsDigestLastOpenedAt" TIMESTAMP(3);

ALTER TABLE "Word"
  ADD COLUMN IF NOT EXISTS "newsExampleText" VARCHAR(2048),
  ADD COLUMN IF NOT EXISTS "newsExampleTier" "NewsExampleTier",
  ADD COLUMN IF NOT EXISTS "newsExampleSourceUrl" VARCHAR(1024),
  ADD COLUMN IF NOT EXISTS "newsExampleSourceTitle" VARCHAR(512),
  ADD COLUMN IF NOT EXISTS "newsExamplePreparedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "newsExampleMatchedWord" VARCHAR(256),
  ADD COLUMN IF NOT EXISTS "newsExampleNeedsRefresh" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "Word_newsExamplePreparedAt_idx" ON "Word"("newsExamplePreparedAt");

CREATE TABLE IF NOT EXISTS "NewsCache" (
  "id" SERIAL NOT NULL,
  "source" VARCHAR(128) NOT NULL,
  "title" VARCHAR(512) NOT NULL,
  "url" VARCHAR(1024) NOT NULL,
  "snippet" VARCHAR(2048) NOT NULL,
  "bodyText" TEXT,
  "language" VARCHAR(16),
  "publishedAt" TIMESTAMP(3),
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "contentHash" VARCHAR(64) NOT NULL,
  CONSTRAINT "NewsCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "NewsCache_contentHash_key" ON "NewsCache"("contentHash");
CREATE INDEX IF NOT EXISTS "NewsCache_publishedAt_idx" ON "NewsCache"("publishedAt");
CREATE INDEX IF NOT EXISTS "NewsCache_expiresAt_idx" ON "NewsCache"("expiresAt");
CREATE INDEX IF NOT EXISTS "NewsCache_language_publishedAt_idx" ON "NewsCache"("language", "publishedAt");

CREATE TABLE IF NOT EXISTS "NewsResolveJob" (
  "id" SERIAL NOT NULL,
  "wordId" INTEGER NOT NULL,
  "status" "NewsResolveJobStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" VARCHAR(512),
  "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NewsResolveJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "NewsResolveJob_wordId_key" ON "NewsResolveJob"("wordId");
CREATE INDEX IF NOT EXISTS "NewsResolveJob_status_scheduledAt_idx" ON "NewsResolveJob"("status", "scheduledAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'NewsResolveJob_wordId_fkey'
  ) THEN
    ALTER TABLE "NewsResolveJob"
      ADD CONSTRAINT "NewsResolveJob_wordId_fkey"
      FOREIGN KEY ("wordId") REFERENCES "Word"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

