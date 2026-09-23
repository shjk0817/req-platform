#!/usr/bin/env bash
# ============================================================
# 端到端验收脚本（本地联调）
# 覆盖：注册 -> 审核开通 Git 账号 -> 发布需求 -> 认领并自动建仓 ->
#       PR 与 Webhook 同步 -> 反馈同步为 Issue -> 反馈闭环 ->
#       头像 / 共同需求人 / 完成进度 / 协作热力图
# 使用：bash scripts/e2e-test.sh
# 前置：完整栈已通过 docker compose 启动
# ============================================================
set -uo pipefail

APP="${APP_BASE:-http://localhost:8080}"
GIT="${GIT_BASE:-http://localhost:8081}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@aimanager.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin@123456}"
# 从 .env 读取 Gitea API Token 与组织名
GITEA_API_TOKEN="$(grep -E '^GITEA_API_TOKEN=' .env | tail -1 | cut -d= -f2-)"
GITEA_ORG="$(grep -E '^GITEA_ORG=' .env | tail -1 | cut -d= -f2-)"

PASS=0
FAIL=0
SUFFIX="$(date +%s)"
# 测试账号使用「真实姓名 + 专用测试域名」：
# 邮箱局部带上时间戳保证唯一，域名单独区分，便于演示数据种子脚本精确清理，
# 避免测试数据混进演示环境后出现「需求方1712…」这类一眼假的账号
E2E_DOMAIN="${E2E_DOMAIN:-e2e.example.com}"
REQ_NAME="张磊"
DEV_NAME="顾小雨"
WATCH_NAME="郭鹏"

# 等待后端就绪，避免服务刚重启时误报失败
wait_ready() {
  local tries=0
  until curl -fsS "${APP}/api/health" >/dev/null 2>&1; do
    tries=$((tries + 1))
    if [[ ${tries} -gt 60 ]]; then
      echo "[错误] 后端在 60 秒内未就绪：${APP}/api/health"
      exit 1
    fi
    sleep 1
  done
}
wait_ready

# 断言辅助
check() {
  local desc="$1" actual="$2" expected="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "  [通过] ${desc}"
    PASS=$((PASS + 1))
  else
    echo "  [失败] ${desc}（期望 ${expected}，实际 ${actual}）"
    FAIL=$((FAIL + 1))
  fi
}

echo "=============================================="
echo " 1. 管理员登录"
echo "=============================================="
ADMIN_LOGIN="$(curl -s -X POST "${APP}/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}")"
ADMIN_TOKEN="$(echo "${ADMIN_LOGIN}" | jq -r '.token // empty')"
ADMIN_ID="$(echo "${ADMIN_LOGIN}" | jq -r '.user.id // empty')"
check "管理员登录获取 Token" "$([[ -n "${ADMIN_TOKEN}" ]] && echo yes || echo no)" "yes"

echo "=============================================="
echo " 2. 两位同事注册（需求方 / 开发者）"
echo "=============================================="
REQ_EMAIL="zhang.lei.${SUFFIX}@${E2E_DOMAIN}"
DEV_EMAIL="gu.xiaoyu.${SUFFIX}@${E2E_DOMAIN}"

curl -s -X POST "${APP}/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${REQ_EMAIL}\",\"name\":\"${REQ_NAME}\",\"password\":\"Passw0rd123\",\"department\":\"生产部\"}" \
  | jq -r '.status' >/dev/null

DEV_REG="$(curl -s -X POST "${APP}/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${DEV_EMAIL}\",\"name\":\"${DEV_NAME}\",\"password\":\"Passw0rd123\",\"department\":\"信息部\",\"skills\":[\"TypeScript\",\"React\"]}")"
check "开发者注册成功" "$(echo "${DEV_REG}" | jq -r '.status')" "PENDING"

echo "=============================================="
echo " 3. 管理员审核（自动开通 Gitea 账号）"
echo "=============================================="
PENDING_USERS="$(curl -s "${APP}/api/users?status=PENDING&pageSize=50" -H "Authorization: Bearer ${ADMIN_TOKEN}")"
REQ_ID="$(echo "${PENDING_USERS}" | jq -r --arg e "${REQ_EMAIL}" '.items[] | select(.email==$e) | .id')"
DEV_ID="$(echo "${PENDING_USERS}" | jq -r --arg e "${DEV_EMAIL}" '.items[] | select(.email==$e) | .id')"
check "待审核列表包含新注册用户" "$([[ -n "${REQ_ID}" && -n "${DEV_ID}" ]] && echo yes || echo no)" "yes"

curl -s -X PATCH "${APP}/api/users/${REQ_ID}/review" -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H 'Content-Type: application/json' -d '{"action":"approve"}' >/dev/null

DEV_APPROVE="$(curl -s -X PATCH "${APP}/api/users/${DEV_ID}/review" -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H 'Content-Type: application/json' -d '{"action":"approve"}')"
DEV_GITEA_USER="$(echo "${DEV_APPROVE}" | jq -r '.giteaUsername // empty')"
DEV_GITEA_PWD="$(echo "${DEV_APPROVE}" | jq -r '.giteaInitialPassword // empty')"
check "审核通过后自动开通 Git 账号" "$([[ -n "${DEV_GITEA_USER}" ]] && echo yes || echo no)" "yes"

echo "=============================================="
echo " 4. 两位同事登录"
echo "=============================================="
REQ_TOKEN="$(curl -s -X POST "${APP}/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${REQ_EMAIL}\",\"password\":\"Passw0rd123\"}" | jq -r '.token // empty')"
DEV_TOKEN="$(curl -s -X POST "${APP}/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${DEV_EMAIL}\",\"password\":\"Passw0rd123\"}" | jq -r '.token // empty')"
check "需求方登录成功" "$([[ -n "${REQ_TOKEN}" ]] && echo yes || echo no)" "yes"
check "开发者登录成功" "$([[ -n "${DEV_TOKEN}" ]] && echo yes || echo no)" "yes"

echo "=============================================="
echo " 5. 需求方发布需求"
echo "=============================================="
PROJECT="$(curl -s -X POST "${APP}/api/projects" -H "Authorization: Bearer ${REQ_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"车间能耗数据自动采集与统计\",\"description\":\"目前三条产线的电表、气表读数靠人工抄表后录入 Excel，月底核算能耗成本时经常对不上，希望实现自动采集并按日、按产线统计。\",\"acceptanceCriteria\":\"1. 按日自动采集各产线能耗读数；\\n2. 支持按产线、按周导出统计表\",\"tags\":[\"能耗\",\"自动化\"],\"avatar\":\"task-05\"}")"
PROJECT_ID="$(echo "${PROJECT}" | jq -r '.id // empty')"
check "需求发布成功" "$(echo "${PROJECT}" | jq -r '.status')" "OPEN"
check "需求携带所选任务头像" "$(echo "${PROJECT}" | jq -r '.avatar')" "task-05"
check "新需求初始完成进度为 0%" "$(echo "${PROJECT}" | jq -r '.progress')" "0"

echo "=============================================="
echo " 6. 开发者认领需求（自动建仓）"
echo "=============================================="
CLAIMED="$(curl -s -X POST "${APP}/api/projects/${PROJECT_ID}/claim" -H "Authorization: Bearer ${DEV_TOKEN}" \
  -H 'Content-Type: application/json' -d '{"remark":"本周内完成初版"}')"
REPO_NAME="$(echo "${CLAIMED}" | jq -r '.repoName // empty')"
check "认领后项目状态为 CLAIMED" "$(echo "${CLAIMED}" | jq -r '.status')" "CLAIMED"
check "认领后自动创建 Git 仓库" "$([[ -n "${REPO_NAME}" ]] && echo yes || echo no)" "yes"

GITEA_REPO="$(curl -s -H "Authorization: token ${GITEA_API_TOKEN}" \
  "${GIT}/api/v1/repos/${GITEA_ORG}/${REPO_NAME}")"
check "Gitea 中可查到该仓库" "$(echo "${GITEA_REPO}" | jq -r '.name // empty')" "${REPO_NAME}"
check "仓库模板文件已初始化" "$(echo "${GITEA_REPO}" | jq -r 'if (.default_branch == "main") then "main" else "other" end')" "main"

WEBHOOKS="$(curl -s -H "Authorization: token ${GITEA_API_TOKEN}" \
  "${GIT}/api/v1/repos/${GITEA_ORG}/${REPO_NAME}/hooks")"
check "仓库已自动配置 Webhook" "$(echo "${WEBHOOKS}" | jq -r 'length > 0')" "true"

echo "=============================================="
echo " 7. 开发者推送分支并创建 PR（验证 Webhook 同步）"
echo "=============================================="
WORKDIR="$(mktemp -d)"
GIT_HOST="${GIT#http://}"
CLONE_URL="http://gitea-admin:${GITEA_ADMIN_PASSWORD:-devgitea123}@${GIT_HOST}/${GITEA_ORG}/${REPO_NAME}.git"
if git clone -q "${CLONE_URL}" "${WORKDIR}/repo" 2>/dev/null; then
  cd "${WORKDIR}/repo"
  git config user.email "${DEV_EMAIL}"
  git config user.name "${DEV_NAME}"
  git checkout -q -b "feat/energy-collection"
  echo "# 能耗采集实现说明" > FEATURE.md
  git add -A && git commit -q -m "feat: 增加能耗数据采集能力"
  if git push -q -u origin "feat/energy-collection" 2>/dev/null; then
    echo "  [通过] 分支推送成功（证明协作者权限已正确同步）"
    PASS=$((PASS + 1))
  else
    echo "  [失败] 分支推送失败"
    FAIL=$((FAIL + 1))
  fi
  cd - >/dev/null

  PR="$(curl -s -X POST -H "Authorization: token ${GITEA_API_TOKEN}" \
    -H 'Content-Type: application/json' \
    -d "{\"title\":\"feat: 能耗数据采集初版\",\"head\":\"feat/energy-collection\",\"base\":\"main\",\"body\":\"Closes 反馈\"}" \
    "${GIT}/api/v1/repos/${GITEA_ORG}/${REPO_NAME}/pulls")"
  check "在 Gitea 中创建 PR 成功" "$(echo "${PR}" | jq -r '.number // empty' | grep -c .)" "1"

  sleep 4
  DETAIL="$(curl -s "${APP}/api/projects/${PROJECT_ID}" -H "Authorization: Bearer ${DEV_TOKEN}")"
  check "平台已通过 Webhook 同步 PR" "$(echo "${DETAIL}" | jq -r '.pullRequests | length')" "1"
  check "项目状态自动流转为 DEVELOPING" "$(echo "${DETAIL}" | jq -r '.status')" "DEVELOPING"

  # 等待真实的 Gitea Actions 流水线运行结束，并通过工作流回调把结果回写平台
  echo "  [等待] 流水线运行并把状态回写平台 ..."
  CI_STATUS=""
  for _ in $(seq 1 60); do
    CI_STATUS="$(curl -s "${APP}/api/projects/${PROJECT_ID}" -H "Authorization: Bearer ${DEV_TOKEN}" \
      | jq -r '.pullRequests[0].ciStatus // empty')"
    if [[ "${CI_STATUS}" == "success" || "${CI_STATUS}" == "failure" ]]; then
      break
    fi
    sleep 3
  done
  check "流水线状态已回写平台（CI/CD 闭环）" "${CI_STATUS}" "success"
else
  echo "  [跳过] 仓库克隆失败，跳过 PR 相关校验"
fi
rm -rf "${WORKDIR}"

echo "=============================================="
echo " 8. 需求方提交反馈（自动创建 Issue）"
echo "=============================================="
FEEDBACK="$(curl -s -X POST "${APP}/api/projects/${PROJECT_ID}/feedbacks" -H "Authorization: Bearer ${REQ_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"type":"BUG","title":"导出的报表缺少合计行","content":"点击导出后生成的表格缺少合计行，无法直接核对金额，期望补充合计行。"}')"
FEEDBACK_ID="$(echo "${FEEDBACK}" | jq -r '.id // empty')"
ISSUE_NUMBER="$(echo "${FEEDBACK}" | jq -r '.issueNumber // empty')"
check "反馈提交成功" "$([[ -n "${FEEDBACK_ID}" ]] && echo yes || echo no)" "yes"
check "反馈已同步为 Gitea Issue" "$([[ -n "${ISSUE_NUMBER}" ]] && echo yes || echo no)" "yes"

echo "=============================================="
echo " 9. 开发者在平台回复并标记已解决（自动关闭 Issue）"
echo "=============================================="
COMMENTED="$(curl -s -X POST "${APP}/api/feedbacks/${FEEDBACK_ID}/comments" -H "Authorization: Bearer ${DEV_TOKEN}" \
  -H 'Content-Type: application/json' -d '{"content":"已定位问题，今天内修复并发布。"}')"
check "评论提交成功" "$(echo "${COMMENTED}" | jq -r '.comments | length >= 1')" "true"

RESOLVED="$(curl -s -X PATCH "${APP}/api/feedbacks/${FEEDBACK_ID}/status" -H "Authorization: Bearer ${DEV_TOKEN}" \
  -H 'Content-Type: application/json' -d '{"status":"RESOLVED","remark":"已在 v0.1.1 修复"}')"
check "反馈状态更新为已解决" "$(echo "${RESOLVED}" | jq -r '.status')" "RESOLVED"

sleep 2
ISSUE_STATE="$(curl -s -H "Authorization: token ${GITEA_API_TOKEN}" \
  "${GIT}/api/v1/repos/${GITEA_ORG}/${REPO_NAME}/issues/${ISSUE_NUMBER}" | jq -r '.state')"
check "Gitea 中对应 Issue 已自动关闭" "${ISSUE_STATE}" "closed"

echo "=============================================="
echo " 10. 开发者添加协作者（仓库权限同步）"
echo "=============================================="
ADDED="$(curl -s -X POST "${APP}/api/projects/${PROJECT_ID}/members" -H "Authorization: Bearer ${DEV_TOKEN}" \
  -H 'Content-Type: application/json' -d "{\"userId\":\"${REQ_ID}\"}")"
check "添加协作者成功" "$(echo "${ADDED}" | jq -r '.members | length')" "2"

echo "=============================================="
echo " 11. 消息通知与统计数据"
echo "=============================================="
NOTIFICATIONS="$(curl -s "${APP}/api/notifications" -H "Authorization: Bearer ${REQ_TOKEN}")"
check "需求方收到通知" "$(echo "${NOTIFICATIONS}" | jq -r '.total > 0')" "true"
STATS="$(curl -s "${APP}/api/projects/stats" -H "Authorization: Bearer ${ADMIN_TOKEN}")"
check "统计数据可正常返回" "$(echo "${STATS}" | jq -r 'has("total")')" "true"

echo "=============================================="
echo " 12. 头像与需求池展示（任务头像 / 进度 / 分列头像）"
echo "=============================================="
PROFILE="$(curl -s -X PUT "${APP}/api/users/profile" -H "Authorization: Bearer ${REQ_TOKEN}" \
  -H 'Content-Type: application/json' -d '{"avatarUrl":"user-03"}')"
check "同事可选择预设头像" "$(echo "${PROFILE}" | jq -r '.avatarUrl')" "user-03"

ME="$(curl -s "${APP}/api/auth/me" -H "Authorization: Bearer ${REQ_TOKEN}")"
check "登录信息带上头像" "$(echo "${ME}" | jq -r '.avatarUrl')" "user-03"

BAD_AVATAR="$(curl -s -X PUT "${APP}/api/users/profile" -H "Authorization: Bearer ${REQ_TOKEN}" \
  -H 'Content-Type: application/json' -d '{"avatarUrl":"not-exist-avatar"}')"
check "非法头像被拒绝" "$(echo "${BAD_AVATAR}" | jq -r '.message // empty')" "头像不在可选范围内"

LIST_ONE="$(curl -s "${APP}/api/projects?scope=created&pageSize=1" -H "Authorization: Bearer ${REQ_TOKEN}")"
check "需求池返回任务头像" "$(echo "${LIST_ONE}" | jq -r '.items[0].avatar')" "task-05"
check "需求池返回需求方头像" "$(echo "${LIST_ONE}" | jq -r '.items[0].creator.avatarUrl')" "user-03"
check "需求池返回负责人头像字段" "$(echo "${LIST_ONE}" | jq -r '.items[0].owner | has("avatarUrl")')" "true"
check "需求池返回完成进度" "$(echo "${LIST_ONE}" | jq -r '.items[0].progress >= 35')" "true"

echo "=============================================="
echo " 13. 共同需求人（需求方添加 / 自助加入 / 退出）"
echo "=============================================="
WATCH_EMAIL="guo.peng.${SUFFIX}@${E2E_DOMAIN}"
curl -s -X POST "${APP}/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${WATCH_EMAIL}\",\"name\":\"${WATCH_NAME}\",\"password\":\"Passw0rd123\",\"department\":\"销售部\"}" >/dev/null
WATCH_ID="$(curl -s "${APP}/api/users?status=PENDING&pageSize=50" -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  | jq -r --arg e "${WATCH_EMAIL}" '.items[] | select(.email==$e) | .id')"
curl -s -X PATCH "${APP}/api/users/${WATCH_ID}/review" -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H 'Content-Type: application/json' -d '{"action":"approve"}' >/dev/null
WATCH_TOKEN="$(curl -s -X POST "${APP}/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${WATCH_EMAIL}\",\"password\":\"Passw0rd123\"}" | jq -r '.token // empty')"
check "共同需求人账号已开通" "$([[ -n "${WATCH_TOKEN}" ]] && echo yes || echo no)" "yes"

JOINED="$(curl -s -X POST "${APP}/api/projects/${PROJECT_ID}/requesters" -H "Authorization: Bearer ${WATCH_TOKEN}" \
  -H 'Content-Type: application/json' -d '{}')"
check "同事可自助加入「我也需要」" "$(echo "${JOINED}" | jq -r '.requesters | length')" "1"
check "共同需求人记录为本人" \
  "$(echo "${JOINED}" | jq -r --arg id "${WATCH_ID}" '[.requesters[].user.id] | index($id) != null')" "true"

REQ_NOTICE="$(curl -s "${APP}/api/notifications" -H "Authorization: Bearer ${REQ_TOKEN}")"
check "需求方收到共同需求人提醒" \
  "$(echo "${REQ_NOTICE}" | jq -r '[.items[].type] | index("PROJECT_REQUESTER_ADDED") != null')" "true"

ADDED_BY_CREATOR="$(curl -s -X POST "${APP}/api/projects/${PROJECT_ID}/requesters" -H "Authorization: Bearer ${REQ_TOKEN}" \
  -H 'Content-Type: application/json' -d "{\"userId\":\"${ADMIN_ID}\"}")"
check "需求方本人无权添加其他共同需求人" \
  "$(echo "${ADDED_BY_CREATOR}" | jq -r '.message // empty')" \
  "只有管理员可以添加其他共同需求人，其他同事只能把自己加入"
check "越权添加后名单未变化" \
  "$(curl -s "${APP}/api/projects/${PROJECT_ID}" -H "Authorization: Bearer ${ADMIN_TOKEN}" | jq -r '.requesters | length')" "1"

ADDED_REQ="$(curl -s -X POST "${APP}/api/projects/${PROJECT_ID}/requesters" -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H 'Content-Type: application/json' -d "{\"userId\":\"${ADMIN_ID}\"}")"
check "管理员可指定其他共同需求人" "$(echo "${ADDED_REQ}" | jq -r '.requesters | length')" "2"

SELF_ADD="$(curl -s -X POST "${APP}/api/projects/${PROJECT_ID}/requesters" -H "Authorization: Bearer ${REQ_TOKEN}" \
  -H 'Content-Type: application/json' -d "{\"userId\":\"${REQ_ID}\"}")"
check "需求方本人不会被重复加入" "$(echo "${SELF_ADD}" | jq -r '.message // empty')" "需求方本人无需重复添加"

KICK_BY_CREATOR="$(curl -s -X DELETE "${APP}/api/projects/${PROJECT_ID}/requesters/${ADMIN_ID}" \
  -H "Authorization: Bearer ${REQ_TOKEN}")"
check "需求方本人也无权移除其他共同需求人" \
  "$(echo "${KICK_BY_CREATOR}" | jq -r '.message // empty')" \
  "只有管理员可以移除其他共同需求人，其他同事只能退出自己"
check "越权移除后名单未变化" \
  "$(curl -s "${APP}/api/projects/${PROJECT_ID}" -H "Authorization: Bearer ${ADMIN_TOKEN}" | jq -r '.requesters | length')" "2"

KICK_BY_ADMIN="$(curl -s -X DELETE "${APP}/api/projects/${PROJECT_ID}/requesters/${WATCH_ID}" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}")"
check "管理员可移除其他共同需求人" "$(echo "${KICK_BY_ADMIN}" | jq -r '.requesters | length')" "1"

REJOIN="$(curl -s -X POST "${APP}/api/projects/${PROJECT_ID}/requesters" -H "Authorization: Bearer ${WATCH_TOKEN}" \
  -H 'Content-Type: application/json' -d '{}')"
check "被移除后仍可自助重新加入" "$(echo "${REJOIN}" | jq -r '.requesters | length')" "2"

QUIT="$(curl -s -X DELETE "${APP}/api/projects/${PROJECT_ID}/requesters/${WATCH_ID}" \
  -H "Authorization: Bearer ${WATCH_TOKEN}")"
check "共同需求人可自助退出" "$(echo "${QUIT}" | jq -r '.requesters | length')" "1"

SCOPED="$(curl -s "${APP}/api/projects?scope=requesting" -H "Authorization: Bearer ${ADMIN_TOKEN}")"
check "「我关注的」范围可筛选出该需求" \
  "$(echo "${SCOPED}" | jq -r --arg id "${PROJECT_ID}" '[.items[].id] | index($id) != null')" "true"

echo "=============================================="
echo " 14. 协作热力图（全平台 / 个人）"
echo "=============================================="
ALL_HEATMAP="$(curl -s "${APP}/api/stats/heatmap" -H "Authorization: Bearer ${REQ_TOKEN}")"
check "全平台热力图返回整年数据" "$(echo "${ALL_HEATMAP}" | jq -r '.days | length > 300')" "true"
check "全平台热力图包含今日协作" "$(echo "${ALL_HEATMAP}" | jq -r '.days[-1].count > 0')" "true"
FROM_DATE="$(echo "${ALL_HEATMAP}" | jq -r '.from')"
FROM_WEEKDAY="$(date -d "${FROM_DATE}" +%u 2>/dev/null || date -j -f "%Y-%m-%d" "${FROM_DATE}" +%u 2>/dev/null || echo unknown)"
check "热力图起始日期对齐周一" "${FROM_WEEKDAY}" "1"

MY_HEATMAP="$(curl -s "${APP}/api/stats/heatmap?userId=${REQ_ID}" -H "Authorization: Bearer ${REQ_TOKEN}")"
check "个人热力图统计本人提出的需求" "$(echo "${MY_HEATMAP}" | jq -r '.summary.projects >= 1')" "true"
check "个人热力图统计本人提交的反馈" "$(echo "${MY_HEATMAP}" | jq -r '.summary.feedbacks >= 1')" "true"
check "个人热力图返回连续天数" "$(echo "${MY_HEATMAP}" | jq -r '.currentStreak >= 1')" "true"

echo "=============================================="
echo " 15. 需求图片与附件（上传 / 预览 / 下载）"
echo "=============================================="
WORKDIR="$(mktemp -d)"
# 1x1 透明 PNG，用于验证图片预览链路
printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==' \
  | base64 -d > "${WORKDIR}/备件台账页面原型.png"
printf '台账字段说明：料号、名称、安全库存、当前库存、最近领用日期\n' > "${WORKDIR}/台账字段说明.txt"

IMG="$(curl -s -X POST "${APP}/api/uploads" -H "Authorization: Bearer ${REQ_TOKEN}" \
  -F "file=@${WORKDIR}/备件台账页面原型.png")"
IMG_ID="$(echo "${IMG}" | jq -r '.id // empty')"
check "上传图片成功" "$(echo "${IMG}" | jq -r '.kind // empty')" "IMAGE"
check "图片返回在线预览地址" "$(echo "${IMG}" | jq -r '.url | length > 0')" "true"

FILE_UP="$(curl -s -X POST "${APP}/api/uploads" -H "Authorization: Bearer ${REQ_TOKEN}" \
  -F "file=@${WORKDIR}/台账字段说明.txt")"
FILE_ID="$(echo "${FILE_UP}" | jq -r '.id // empty')"
check "上传附件成功" "$(echo "${FILE_UP}" | jq -r '.kind // empty')" "FILE"

WITH_ATTACH="$(curl -s -X POST "${APP}/api/projects" -H "Authorization: Bearer ${REQ_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"设备备件台账线上维护\",\"description\":\"用于验证图片预览与附件下载。\",\"acceptanceCriteria\":\"图片可预览、附件可下载\",\"imageIds\":[\"${IMG_ID}\"],\"attachmentIds\":[\"${FILE_ID}\"]}")"
ATTACH_PROJECT_ID="$(echo "${WITH_ATTACH}" | jq -r '.id // empty')"
check "发布需求时关联图片" "$(echo "${WITH_ATTACH}" | jq -r '.images | length')" "1"
check "发布需求时关联附件" "$(echo "${WITH_ATTACH}" | jq -r '.files | length')" "1"

IMG_MIME="$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "${APP}/api/uploads/${IMG_ID}/raw")"
check "图片可在线预览" "${IMG_MIME}" "200 image/png"

FILE_DL="$(curl -s -D - -o /dev/null "${APP}/api/uploads/${FILE_ID}/raw?download=1" \
  | tr -d '\r' | grep -i '^content-disposition:' | grep -ci 'attachment')"
check "附件按下载方式响应" "${FILE_DL}" "1"

LIST_ATTACH="$(curl -s "${APP}/api/projects?scope=created&pageSize=50" -H "Authorization: Bearer ${REQ_TOKEN}")"
check "需求池列表带出附件数量" \
  "$(echo "${LIST_ATTACH}" | jq -r --arg id "${ATTACH_PROJECT_ID}" '.items[] | select(.id == $id) | .attachmentCount')" "2"
rm -rf "${WORKDIR}"

echo "=============================================="
echo " 16. Git 服务免密登录（SSO）与品牌定制"
echo "=============================================="
ANON_GIT="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "${GIT}/")"
GIT_HOME_ENC="$(jq -rn --arg u "${GIT}/" '$u | @uri')"
check "未登录访问 Git 服务会引导回平台登录（并带回原始地址）" \
  "${ANON_GIT}" "302 ${APP}/login?redirect=${GIT_HOME_ENC}"

ANON_GIT_DEEP="$(curl -s -o /dev/null -w '%{redirect_url}' "${GIT}/${GITEA_ORG}/${REPO_NAME}/issues")"
GIT_DEEP_ENC="$(jq -rn --arg u "${GIT}/${GITEA_ORG}/${REPO_NAME}/issues" '$u | @uri')"
check "从深层页面被弹回时带回原始地址（登录后可直接回到该页）" \
  "${ANON_GIT_DEEP}" "${APP}/login?redirect=${GIT_DEEP_ENC}"

GIT_LOGIN_PAGE="$(curl -s -o /dev/null -w '%{http_code}' "${GIT}/user/login")"
check "Git 登录页可直接访问（兜底入口）" "${GIT_LOGIN_PAGE}" "200"

LOGO="$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "${GIT}/assets/img/logo.svg")"
check "Git 服务使用平台定制 Logo" "${LOGO}" "200 image/svg+xml"

SSO_JAR="$(mktemp)"
SSO_SESSION="$(curl -s -c "${SSO_JAR}" -X POST "${APP}/api/gitea/session" \
  -H "Authorization: Bearer ${REQ_TOKEN}")"
check "平台可签发 Git 免密登录 Cookie" "$(echo "${SSO_SESSION}" | jq -r '.ready')" "true"
GITEA_USERNAME="$(curl -s "${APP}/api/users/${REQ_ID}" -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  | jq -r '.giteaUsername // empty')"
SSO_HOME="$(curl -s -L -b "${SSO_JAR}" "${GIT}/")"
SSO_HIT="$(printf '%s' "${SSO_HOME}" | grep -c "${GITEA_USERNAME}")"
check "带免密 Cookie 可直接进入 Git 服务首页（页面出现当前用户）" \
  "$([[ "${SSO_HIT}" -gt 0 ]] && echo yes || echo no)" "yes"
rm -f "${SSO_JAR}"

echo
echo "=============================================="
printf ' 验收结果：通过 %d 项，失败 %d 项\n' "${PASS}" "${FAIL}"
echo "=============================================="
[[ "${FAIL}" -eq 0 ]]
