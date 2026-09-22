#!/bin/sh
# ============================================================
# 后端容器启动脚本
# 作用：先执行数据库迁移，再启动 NestJS 服务
# ============================================================
set -e

echo "[entrypoint] 准备附件存储目录 ..."
mkdir -p "${UPLOAD_DIR:-/app/uploads}"

echo "[entrypoint] 执行数据库迁移 ..."
npx prisma migrate deploy

echo "[entrypoint] 启动平台后端服务 ..."
exec node dist/main
