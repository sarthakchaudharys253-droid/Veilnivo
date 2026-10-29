CREATE TABLE "Group" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "keyVersion" INTEGER NOT NULL DEFAULT 1,
  "needsRekey" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "lastMessageAt" TIMESTAMP(3),
  CONSTRAINT "Group_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Group_keyVersion_positive" CHECK ("keyVersion">0)
);
CREATE TABLE "GroupMember" (
  "groupId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "joinedVersion" INTEGER NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("groupId","userId"),
  CONSTRAINT "GroupMember_joinedVersion_positive" CHECK ("joinedVersion">0)
);
CREATE TABLE "GroupKeyEnvelope" (
  "groupId" TEXT NOT NULL,
  "keyVersion" INTEGER NOT NULL,
  "userId" TEXT NOT NULL,
  "wrappedById" TEXT NOT NULL,
  "wrappedByPublicKeyJwk" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  CONSTRAINT "GroupKeyEnvelope_pkey" PRIMARY KEY ("groupId","keyVersion","userId"),
  CONSTRAINT "GroupKeyEnvelope_keyVersion_positive" CHECK ("keyVersion">0)
);
CREATE TABLE "GroupMessage" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "clientMessageId" TEXT NOT NULL,
  "keyVersion" INTEGER NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GroupMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GroupMessage_keyVersion_positive" CHECK ("keyVersion">0)
);
CREATE INDEX "Group_ownerId_idx" ON "Group"("ownerId");
CREATE INDEX "GroupMember_userId_groupId_idx" ON "GroupMember"("userId","groupId");
CREATE INDEX "GroupKeyEnvelope_userId_groupId_keyVersion_idx" ON "GroupKeyEnvelope"("userId","groupId","keyVersion");
CREATE INDEX "GroupKeyEnvelope_wrappedById_idx" ON "GroupKeyEnvelope"("wrappedById");
CREATE UNIQUE INDEX "GroupMessage_senderId_clientMessageId_key" ON "GroupMessage"("senderId","clientMessageId");
CREATE INDEX "GroupMessage_groupId_createdAt_id_idx" ON "GroupMessage"("groupId","createdAt","id");
CREATE INDEX "GroupMessage_groupId_keyVersion_idx" ON "GroupMessage"("groupId","keyVersion");
ALTER TABLE "Group" ADD CONSTRAINT "Group_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupKeyEnvelope" ADD CONSTRAINT "GroupKeyEnvelope_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupKeyEnvelope" ADD CONSTRAINT "GroupKeyEnvelope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupMessage" ADD CONSTRAINT "GroupMessage_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupMessage" ADD CONSTRAINT "GroupMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
