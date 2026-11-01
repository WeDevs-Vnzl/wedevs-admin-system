-- Δ15 (DT-136, DT-137): a version restore reuses its file, so DocumentVersion.fileId is no longer unique;
-- ShareLink.expiresAt is a calendar date; ShareLink.expiredAt marks the expired-links step. No backfill.

-- DropIndex
DROP INDEX "DocumentVersion_fileId_key";

-- AlterTable
ALTER TABLE "ShareLink" ADD COLUMN     "expiredAt" TIMESTAMP(3),
ALTER COLUMN "expiresAt" SET DATA TYPE DATE;

-- CreateIndex
CREATE INDEX "DocumentVersion_fileId_idx" ON "DocumentVersion"("fileId");

-- CreateIndex
CREATE INDEX "ShareLinkDocument_documentId_idx" ON "ShareLinkDocument"("documentId");
