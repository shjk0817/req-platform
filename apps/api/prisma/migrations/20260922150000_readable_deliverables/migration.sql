-- 仓库可读命名与成果展示字段
ALTER TABLE "projects"
  ADD COLUMN "repoDisplayName" TEXT,
  ADD COLUMN "demoUrl" TEXT;
