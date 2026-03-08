CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "NewsCache_title_trgm_idx"
  ON "NewsCache" USING gin (lower("title") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "NewsCache_snippet_trgm_idx"
  ON "NewsCache" USING gin (lower("snippet") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "NewsCache_bodyText_trgm_idx"
  ON "NewsCache" USING gin (lower(coalesce("bodyText", '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "NewsCache_url_trgm_idx"
  ON "NewsCache" USING gin (lower("url") gin_trgm_ops);