DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'NewsExampleTier'
      AND e.enumlabel = 'GUARDIAN'
      AND n.nspname = current_schema()
  ) THEN
    ALTER TYPE "NewsExampleTier" ADD VALUE 'GUARDIAN';
  END IF;
END $$;
