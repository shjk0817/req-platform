# MCP / CLI 安全边界

## 认证与权限

平台个人访问令牌只存储 SHA-256 哈希、名称、scope、过期、撤销和最后使用时间；明文只在创建时返回一次。当前 scope：

- `read`：读取工作上下文、项目、反馈、通知和成果。
- `project:write`：发布、认领、加入开发、发布沟通和同步项目记录。
- `feedback:write`：提交反馈与评论。
- `git:metadata`：读取 clone 地址和同步仓库元数据。

scope 之外仍会执行项目负责人、项目成员和管理员等领域授权。JWT 与 PAT 使用同一 `AuthUser` 结构，但 Agent API 的 `@Scopes` 接口只接受 PAT，避免浏览器登录态被脚本复用。

## 凭据职责

- 平台 PAT：调用 `/api/agent/*`，保存在操作系统钥匙串。
- Gitea PAT：由员工自己在 Gitea 创建，CLI 仅用于 PR、CI 和 Release API。
- Git push：默认使用员工本机 SSH Agent。
- `GITEA_API_TOKEN`：仅运行在平台后端，用于平台自动建仓、Webhook 和系统同步，绝不会返回给 CLI、MCP 或浏览器。

文件凭据是显式降级方案，只有 `AIM_ALLOW_FILE_CREDENTIALS=true` 才启用，并写入 `~/.config/aimanager/credentials.json`（`0600`）。

## Git 防护

本地 Git 使用 `execFile` 参数数组，不拼接 shell；工作目录必须在 `AIMANAGER_WORKSPACE` 下；远程地址拒绝内嵌凭据；分支只允许 `feature/`、`fix/`、`chore/`；拒绝 `main` 直接 push、force、mirror、危险 refspec；提交前检查 `.env`、私钥、证书和密钥文件。

## 写操作确认

commit、push、PR 和 Release 都先生成 10 分钟 action id。支持 MCP elicitation 时由 MCP 客户端展示确认表单；不支持时由员工执行 `aim approve <id>`。action 一次性消费，过期、错误格式或已执行的 id 都会被拒绝。

## 审计与撤销

每个 Agent 写操作写入 `agent_audit_events`，包含用户、令牌、动作、资源、request id 和业务参数，不写入密码和令牌明文。发现令牌泄露时，立即在个人资料页撤销，并在 Gitea 撤销员工 PAT；平台管理员可以通过数据库审计记录追踪调用来源。

## 上线检查清单

上线远程 MCP 或 CLI 包前，管理员应确认：

1. `NODE_ENV=production`，关闭开发用户选择器，并使用 HTTPS 暴露平台与 `/mcp`。
2. `JWT_SECRET`、`GITEA_API_TOKEN`、Webhook 密钥和数据库密码均来自部署密钥管理，
   不写入镜像、日志、仓库或 npm 包。
3. `GITEA_API_TOKEN` 只存在 API 容器；`agent-mcp` 和员工设备不能读取该变量。
4. 个人 PAT 设置合理有效期，按最小 scope 创建；离职或疑似泄露时立即撤销。
5. 员工 Gitea PAT 只保存于系统钥匙串；文件凭据仅用于临时测试，并在测试结束后删除。
6. 发布前执行 API 单元测试、Agent API 权限测试、MCP 协议测试、CLI 测试和真实 Gitea
   clone → branch → commit → push → PR → CI 回写 E2E。

排障时可用 request id 在 `agent_audit_events` 中定位写操作；查询审计记录时不要把
`input` 原样复制到聊天、工单或日志之外的公共位置。
