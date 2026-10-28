-- Preserve message identity and expiry while edits replace encrypted snapshots.
-- Deletions retain only a content-free history tombstone for offline clients.
ALTER TABLE "Message" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Message" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "SendNonce_clientMessageId_idx" ON "SendNonce"("clientMessageId");
