ALTER TABLE "User"
    ADD COLUMN "reviewFlowHintShownCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "User"
SET "reviewFlowHintShownCount" = CASE
    WHEN "reviewFlowHintShownAt" IS NOT NULL THEN 1
    ELSE 0
END;
