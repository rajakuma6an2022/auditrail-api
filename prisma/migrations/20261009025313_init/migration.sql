-- CreateEnum
CREATE TYPE "Level" AS ENUM ('INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MagicLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MagicLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" "Level" NOT NULL,
    "service" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "MagicLink_tokenHash_key" ON "MagicLink"("tokenHash");

-- CreateIndex
CREATE INDEX "MagicLink_userId_idx" ON "MagicLink"("userId");

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_createdAt_id_idx" ON "AuditEvent"("tenantId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_level_createdAt_id_idx" ON "AuditEvent"("tenantId", "level", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_action_createdAt_id_idx" ON "AuditEvent"("tenantId", "action", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_service_createdAt_id_idx" ON "AuditEvent"("tenantId", "service", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_actorId_createdAt_id_idx" ON "AuditEvent"("tenantId", "actorId", "createdAt" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "MagicLink" ADD CONSTRAINT "MagicLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
