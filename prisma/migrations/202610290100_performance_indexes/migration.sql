-- Directional latest-message probes can stop at the newest live record instead
-- of sorting the full conversation. Existing indexes remain available.
CREATE INDEX "Message_senderId_recipientId_createdAt_id_idx"
  ON "Message"("senderId","recipientId","createdAt","id");

-- Logical message identifiers are checked across authors and protocols before
-- insertion. The sender-prefixed unique index cannot efficiently serve this
-- global lookup. SendNonce already has its equivalent standalone index.
CREATE INDEX "GroupMessage_clientMessageId_idx"
  ON "GroupMessage"("clientMessageId");
