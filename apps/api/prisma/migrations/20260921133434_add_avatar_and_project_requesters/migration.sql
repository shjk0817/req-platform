-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "avatar" TEXT;

-- CreateTable
CREATE TABLE "project_requesters" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_requesters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_requesters_projectId_idx" ON "project_requesters"("projectId");

-- CreateIndex
CREATE INDEX "project_requesters_userId_idx" ON "project_requesters"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "project_requesters_projectId_userId_key" ON "project_requesters"("projectId", "userId");

-- AddForeignKey
ALTER TABLE "project_requesters" ADD CONSTRAINT "project_requesters_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_requesters" ADD CONSTRAINT "project_requesters_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
