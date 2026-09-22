#!/usr/bin/env bash
# ============================================================
# Gitea 一键初始化脚本
# 作用：
#   1. 创建 Gitea 管理员账号
#   2. 创建存放所有项目仓库的组织
#   3. 生成平台后端调用所需的 API Token（写回 .env）
#   4. 生成 act_runner 注册令牌（写入 deploy/runner/.registration-token）
#   5. 初始化仓库模板（供新建项目仓库时使用）
# 使用：./deploy/gitea/init.sh
# 说明：脚本可重复执行，已存在的资源会自动跳过
# ============================================================
set -euo pipefail

# ---------- 路径与环境 ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${ROOT_DIR}"

if [[ ! -f .env ]]; then
  echo "[init] 未找到 .env，请先执行: cp .env.example .env 并修改配置"
  exit 1
fi

# 读取 .env（忽略注释行）
set -a
# shellcheck disable=SC1091
source .env
set +a

GITEA_ADMIN_USER="${GITEA_ADMIN_USER:-gitea-admin}"
GITEA_ADMIN_PASSWORD="${GITEA_ADMIN_PASSWORD:-change-me-gitea-admin}"
GITEA_ADMIN_EMAIL="${GITEA_ADMIN_EMAIL:-admin@example.com}"
GITEA_ORG="${GITEA_ORG:-projects}"
GITEA_ROOT_URL="${GITEA_ROOT_URL:-http://git.localhost/}"
# 容器内访问地址（脚本通过 docker exec 在 gitea 容器内执行 curl）
GITEA_LOCAL_URL="http://localhost:3000"

# ---------- 工具函数 ----------
log() { echo "[init] $*"; }
warn() { echo "[init][警告] $*" >&2; }

# 在 gitea 容器内执行 curl，避免依赖宿主机网络与证书配置
gitea_curl() {
  docker compose exec -T gitea curl -fsS "$@"
}

# 等待 Gitea 就绪
wait_for_gitea() {
  log "等待 Gitea 就绪 ..."
  for _ in $(seq 1 60); do
    if gitea_curl "${GITEA_LOCAL_URL}/api/healthz" >/dev/null 2>&1; then
      log "Gitea 已就绪"
      return 0
    fi
    sleep 3
  done
  echo "[init][错误] Gitea 启动超时，请执行 docker compose logs gitea 查看日志" >&2
  exit 1
}

# 创建管理员账号（幂等）
create_admin() {
  log "检查管理员账号 ${GITEA_ADMIN_USER}"
  # 注意：gitea CLI 不允许以 root 身份运行，必须指定容器内的 git 用户
  if docker compose exec -T -u git gitea gitea admin user list --admin 2>/dev/null \
    | grep -qw "${GITEA_ADMIN_USER}"; then
    log "管理员账号已存在，跳过"
    return 0
  fi
  docker compose exec -T -u git gitea gitea admin user create \
    --admin \
    --username "${GITEA_ADMIN_USER}" \
    --password "${GITEA_ADMIN_PASSWORD}" \
    --email "${GITEA_ADMIN_EMAIL}" \
    --must-change-password=false
  log "管理员账号创建完成"
}

# 管理员 API 基础认证参数
admin_auth() {
  echo "-u" "${GITEA_ADMIN_USER}:${GITEA_ADMIN_PASSWORD}"
}

# 创建组织（幂等）
create_org() {
  log "检查组织 ${GITEA_ORG}"
  if gitea_curl "$(admin_auth)" "${GITEA_LOCAL_URL}/api/v1/orgs/${GITEA_ORG}" >/dev/null 2>&1; then
    log "组织已存在，跳过"
    return 0
  fi
  gitea_curl "$(admin_auth)" -X POST \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"${GITEA_ORG}\",\"visibility\":\"limited\",\"description\":\"平台项目仓库组织\"}" \
    "${GITEA_LOCAL_URL}/api/v1/orgs" >/dev/null
  log "组织创建完成"
}

# 生成 API Token 并写回 .env（幂等：已配置则不重复生成）
create_api_token() {
  if [[ -n "${GITEA_API_TOKEN:-}" ]]; then
    log "GITEA_API_TOKEN 已配置，跳过生成"
    return 0
  fi

  log "生成平台 API Token"
  local token_name="aimanager-platform-$(date +%Y%m%d%H%M%S)"
  # write:admin 用于审核通过后自动开通 Git 账号；其余用于仓库、Issue 与通知
  local scopes='["write:admin","write:repository","write:organization","write:issue","write:user","write:notification","read:admin","read:repository","read:organization","read:issue","read:user"]'
  local response
  response="$(gitea_curl "$(admin_auth)" -X POST \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"${token_name}\",\"scopes\":${scopes}}" \
    "${GITEA_LOCAL_URL}/api/v1/users/${GITEA_ADMIN_USER}/tokens")"

  # 简易 JSON 解析（避免依赖 jq）
  local token
  token="$(printf '%s' "${response}" | sed -n 's/.*"sha1"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  if [[ -z "${token}" ]]; then
    echo "[init][错误] 解析 API Token 失败，响应：${response}" >&2
    exit 1
  fi

  # 写回 .env
  if grep -q '^GITEA_API_TOKEN=' .env; then
    # macOS 与 Linux 的 sed 行为不同，统一使用临时文件方式
    awk -v t="${token}" 'BEGIN{FS=OFS="="} /^GITEA_API_TOKEN=/{print "GITEA_API_TOKEN="t; next} {print}' \
      .env > .env.tmp && mv .env.tmp .env
  else
    printf 'GITEA_API_TOKEN=%s\n' "${token}" >> .env
  fi
  log "API Token 已写入 .env"
}

# 生成 act_runner 注册令牌（幂等）
create_runner_token() {
  local token_file="${ROOT_DIR}/deploy/runner/.registration-token"
  if [[ -s "${token_file}" ]]; then
    log "Runner 注册令牌已存在，跳过生成（如需重置请删除 ${token_file}）"
    return 0
  fi

  log "生成 act_runner 注册令牌"
  # gitea CLI 会在 stdout 输出启动日志，因此这里只取最后一行非空输出作为令牌
  local token
  token="$(docker compose exec -T -u git gitea gitea actions generate-runner-token 2>/dev/null \
    | awk 'NF { last = $0 } END { print last }' | tr -d '\r\n')"
  if [[ -z "${token}" ]]; then
    warn "生成 Runner 注册令牌失败，请手动执行：docker compose exec -u git gitea gitea actions generate-runner-token"
    return 0
  fi
  printf '%s' "${token}" > "${token_file}"
  log "Runner 注册令牌已写入 ${token_file}，请执行 docker compose restart gitea-runner 使其生效"
}

# 初始化仓库模板（把 deploy/templates/repo-template 推送到组织的模板仓库）
init_repo_template() {
  local template_dir="${ROOT_DIR}/deploy/templates/repo-template"
  if [[ ! -d "${template_dir}" ]]; then
    warn "未找到仓库模板目录，跳过"
    return 0
  fi

  log "初始化仓库模板 ${GITEA_ORG}/repo-template"
  if gitea_curl "$(admin_auth)" "${GITEA_LOCAL_URL}/api/v1/repos/${GITEA_ORG}/repo-template" >/dev/null 2>&1; then
    log "模板仓库已存在，将同步最新的模板内容"
  else
    # 通过 API 创建模板仓库
    gitea_curl "$(admin_auth)" -X POST \
      -H "Content-Type: application/json" \
      -d '{"name":"repo-template","description":"新项目仓库模板","private":true,"auto_init":false,"default_branch":"main"}' \
      "${GITEA_LOCAL_URL}/api/v1/orgs/${GITEA_ORG}/repos" >/dev/null
  fi

  # 使用容器内 git 强制推送模板内容，保证模板仓库与 deploy/templates 保持一致
  docker compose exec -T gitea sh -c "
    set -e
    rm -rf /tmp/repo-template && mkdir -p /tmp/repo-template
    cd /tmp/repo-template
    git init -q -b main
    git config user.email '${GITEA_ADMIN_EMAIL}'
    git config user.name '${GITEA_ADMIN_USER}'
    cp -r /templates/repo-template/. .
    git add -A
    git commit -q -m 'chore: 同步项目仓库模板'
    git remote add origin http://${GITEA_ADMIN_USER}:${GITEA_ADMIN_PASSWORD}@localhost:3000/${GITEA_ORG}/repo-template.git
    git push -q -f -u origin main
  "
  # 将仓库设为模板仓库，平台建仓时可直接引用
  gitea_curl "$(admin_auth)" -X PATCH \
    -H "Content-Type: application/json" \
    -d '{"template":true}' \
    "${GITEA_LOCAL_URL}/api/v1/repos/${GITEA_ORG}/repo-template" >/dev/null
  log "仓库模板初始化完成"
}

# ---------- 主流程 ----------
main() {
  wait_for_gitea
  create_admin
  create_org
  create_api_token
  create_runner_token
  init_repo_template

  echo
  log "初始化完成。后续步骤："
  echo "  1. docker compose restart gitea-runner   # 让 Runner 完成注册"
  echo "  2. docker compose up -d api web caddy    # 启动平台服务"
  echo "  3. 访问 ${APP_URL:-http://app.localhost} 使用管理员账号登录平台"
}

main "$@"
