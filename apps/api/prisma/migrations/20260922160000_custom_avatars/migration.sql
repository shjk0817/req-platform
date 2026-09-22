-- 为自定义头像增加独立附件关联，避免头像被孤儿附件清理任务误删
ALTER TABLE "users" ADD COLUMN "avatarAttachmentId" TEXT;

CREATE UNIQUE INDEX "users_avatarAttachmentId_key" ON "users"("avatarAttachmentId");

ALTER TABLE "users"
ADD CONSTRAINT "users_avatarAttachmentId_fkey"
FOREIGN KEY ("avatarAttachmentId") REFERENCES "attachments"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
