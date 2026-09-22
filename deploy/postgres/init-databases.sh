#!/bin/sh
# ============================================================
# PostgreSQL 初始化脚本
# 作用：在首次启动时额外创建 Gitea 所需数据库
# 说明：
#   1. docker-entrypoint-initdb.d 中的脚本仅在数据卷为空时执行一次；
#   2. 基础镜像为 alpine，必须使用 sh 而非 bash；
#   3. 脚本可重复执行，数据库已存在时不会报错。
# ============================================================
set -eu

GITEA_DB_NAME="${GITEA_DB_NAME:-gitea}"

echo "[init-db] 创建 Gitea 数据库: ${GITEA_DB_NAME}"

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" <<-EOSQL
    SELECT 'CREATE DATABASE ${GITEA_DB_NAME} OWNER ${POSTGRES_USER}'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${GITEA_DB_NAME}')\gexec
EOSQL

echo "[init-db] 完成"
