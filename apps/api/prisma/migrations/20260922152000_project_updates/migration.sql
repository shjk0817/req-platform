-- 项目沟通与追加需求记录
CREATE TYPE "ProjectUpdateKind" AS ENUM ('COMMUNICATION', 'ADDITIONAL_REQUIREMENT');

ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_UPDATE_CREATED';

CREATE TABLE "project_updates" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "kind" "ProjectUpdateKind" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_updates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "project_updates_projectId_createdAt_idx" ON "project_updates"("projectId", "createdAt");
CREATE INDEX "project_updates_authorId_idx" ON "project_updates"("authorId");

ALTER TABLE "project_updates"
    ADD CONSTRAINT "project_updates_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_updates"
    ADD CONSTRAINT "project_updates_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
