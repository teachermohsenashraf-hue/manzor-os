ALTER TABLE "Attachment" ADD COLUMN "deliverableId" TEXT;
ALTER TABLE "Attachment" ADD COLUMN "verifiedAt" TIMESTAMP(3);
ALTER TABLE "Attachment" ADD COLUMN "uploadExpiresAt" TIMESTAMP(3);
CREATE INDEX "Attachment_projectId_kind_verifiedAt_idx" ON "Attachment"("projectId", "kind", "verifiedAt");
