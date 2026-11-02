-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('STRIPE', 'BINANCE', 'BANK');

-- CreateEnum
CREATE TYPE "IntegrationEventOutcome" AS ENUM ('PROCESSED', 'IGNORED', 'PARKED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentLinkStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'SETTLED', 'DEACTIVATED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EntityType" ADD VALUE 'PAYMENT_LINK';
ALTER TYPE "EntityType" ADD VALUE 'API_TOKEN';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalProvider" "IntegrationProvider";

-- CreateTable
CREATE TABLE "IntegrationEvent" (
    "id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "outcome" "IntegrationEventOutcome" NOT NULL,
    "reasonCode" TEXT,
    "entityType" "EntityType",
    "entityId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "prefix" VARCHAR(12) NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoicePaymentLink" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "requestId" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "externalId" TEXT,
    "url" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PaymentLinkStatus" NOT NULL DEFAULT 'PENDING',
    "paymentId" TEXT,
    "deactivationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "deactivatedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "InvoicePaymentLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationEvent_provider_outcome_receivedAt_idx" ON "IntegrationEvent"("provider", "outcome", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationEvent_provider_eventId_key" ON "IntegrationEvent"("provider", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ApiToken_userId_revokedAt_idx" ON "ApiToken"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InvoicePaymentLink_externalId_key" ON "InvoicePaymentLink"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoicePaymentLink_paymentId_key" ON "InvoicePaymentLink"("paymentId");

-- CreateIndex
CREATE INDEX "InvoicePaymentLink_invoiceId_status_idx" ON "InvoicePaymentLink"("invoiceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "InvoicePaymentLink_invoiceId_requestId_key" ON "InvoicePaymentLink"("invoiceId", "requestId");

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePaymentLink" ADD CONSTRAINT "InvoicePaymentLink_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePaymentLink" ADD CONSTRAINT "InvoicePaymentLink_currency_fkey" FOREIGN KEY ("currency") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePaymentLink" ADD CONSTRAINT "InvoicePaymentLink_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Provider-originated payments are unique per (provider, id); manual payments carry neither (Prisma cannot express a partial index).
CREATE UNIQUE INDEX "Payment_externalProvider_externalId_key" ON "Payment"("externalProvider", "externalId") WHERE "externalProvider" IS NOT NULL AND "externalId" IS NOT NULL;

-- A payment link always asks for a positive amount.
ALTER TABLE "InvoicePaymentLink" ADD CONSTRAINT "InvoicePaymentLink_amount_positive" CHECK ("amount" > 0);
