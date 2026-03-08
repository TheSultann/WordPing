-- Deduplicate rows by URL, keep the most recently fetched record.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY url
      ORDER BY "fetchedAt" DESC, id DESC
    ) AS rn
  FROM "NewsCache"
)
DELETE FROM "NewsCache" c
USING ranked r
WHERE c.id = r.id
  AND r.rn > 1;

-- Enforce unique URL constraint for atomic upsert by URL.
ALTER TABLE "NewsCache"
ADD CONSTRAINT "NewsCache_url_key" UNIQUE ("url");
