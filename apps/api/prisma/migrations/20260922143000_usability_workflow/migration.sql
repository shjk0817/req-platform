-- 需求协作平台体验改进：技能匹配、验收清单、认领交还与通知分类
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROJECT_MATCHED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROJECT_STATUS_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROJECT_OVERDUE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROJECT_NUDGED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'FEEDBACK_UPDATED';

CREATE TYPE "AcceptanceItemResult" AS ENUM ('PENDING', 'PASSED', 'FAILED');

ALTER TABLE "projects"
  ADD COLUMN "requiredSkills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "acceptedAt" TIMESTAMP(3);

ALTER TABLE "project_claims"
  ADD COLUMN "returnedAt" TIMESTAMP(3),
  ADD COLUMN "returnRemark" TEXT;

CREATE TABLE "acceptance_items" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "sort" INTEGER NOT NULL DEFAULT 0,
  "result" "AcceptanceItemResult" NOT NULL DEFAULT 'PENDING',
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "acceptance_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "acceptance_items_projectId_sort_idx" ON "acceptance_items"("projectId", "sort");

ALTER TABLE "acceptance_items"
  ADD CONSTRAINT "acceptance_items_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
