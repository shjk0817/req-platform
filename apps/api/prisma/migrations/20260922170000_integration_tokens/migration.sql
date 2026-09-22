-- 增加 CLI / MCP 个人访问令牌与 Agent 写操作审计
CREATE TABLE "integration_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integration_tokens_tokenHash_key" ON "integration_tokens"("tokenHash");
CREATE INDEX "integration_tokens_userId_revokedAt_idx" ON "integration_tokens"("userId", "revokedAt");

ALTER TABLE "integration_tokens"
ADD CONSTRAINT "integration_tokens_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "agent_audit_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "requestId" TEXT,
    "input" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_audit_events_userId_createdAt_idx" ON "agent_audit_events"("userId", "createdAt");
CREATE INDEX "agent_audit_events_resource_resourceId_idx" ON "agent_audit_events"("resource", "resourceId");

ALTER TABLE "agent_audit_events"
ADD CONSTRAINT "agent_audit_events_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_audit_events"
ADD CONSTRAINT "agent_audit_events_tokenId_fkey"
FOREIGN KEY ("tokenId") REFERENCES "integration_tokens"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
