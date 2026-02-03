-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SessionState" ADD VALUE 'SETTINGS_WAIT_INTERVAL';
ALTER TYPE "SessionState" ADD VALUE 'SETTINGS_WAIT_GOAL';

