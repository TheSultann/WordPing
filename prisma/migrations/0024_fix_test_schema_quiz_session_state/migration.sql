DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'SessionState'
          AND n.nspname = current_schema()
          AND e.enumlabel = 'QUIZ_ACTIVE'
    ) THEN
        ALTER TYPE "SessionState" ADD VALUE 'QUIZ_ACTIVE';
    END IF;
END
$$;
