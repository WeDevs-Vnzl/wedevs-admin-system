-- AlterTable
ALTER TABLE "InvoicePaymentLink" ADD COLUMN     "providerDeactivatedAt" TIMESTAMP(3);

-- A deactivated link that never reached the provider (no externalId) owes no provider call; those with an
-- externalId stay null so the daily step confirms them once (DT-196).
UPDATE "InvoicePaymentLink" SET "providerDeactivatedAt" = "deactivatedAt" WHERE "status" = 'DEACTIVATED' AND "externalId" IS NULL;
