# aiManager MCP 与 CLI 使用与部署教程

本文说明 **当前开发完成度**、**管理员如何部署**、**员工如何安装配置**，以及 **Cursor / Claude 等客户端如何接入 MCP**。更细的安全边界见 [security.md](./security.md)，命令参考见 [cli.md](./cli.md) 与 [mcp.md](./mcp.md)。

---

## 一、现在开发到什么程度了？

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| 平台 Agent API | 已上线 | `/api/agent/*`，聚合需求、反馈、通知、成果、Git 元数据；`GET /api/agent/capabilities` 声明版本与能力 |
| 个人访问令牌（PAT） | 已上线 | 个人资料页「AI 工具访问」创建；scope：`read` / `project:write` / `feedback:write` / `git:metadata`；写操作有审计 |
| 远程 MCP（HTTP） | 已上线 | Docker 服务 `agent-mcp`，经 Caddy 暴露 `/mcp`；Streamable HTTP，Bearer `aim_...` |
| 本地 MCP（stdio） | 已上线 | 命令 `aim-mcp`，含平台工具 + 本机 Git/PR/CI/Release |
| `aim` CLI | 已上线 | `auth` / `config` / `project` / `feedback` / `git` / `pr` / `ci` / `release` / `approve` / `doctor` |
| Git 安全与写操作确认 | 已上线 | 限制工作区与分支名；`commit`/`push`/PR/Release 需 MCP 确认或 `aim approve` |
| 自动化测试 | 已通过 | API 单测、agent-tools 9 项测试（含 MCP initialize 握手）、全链路 E2E 68 项 |
| npm 公开发布 | 待你们环境 | 包名 `@aimanager/agent-tools`，需配置内部 Registry 后 `npm publish`；开发期可用源码 `npm link` |

**设计原则（一句话）**：平台只给身份、上下文和审计；**代码 clone/push 走 Gitea（SSH 或员工自己的 Gitea PAT）**，绝不把服务端 `GITEA_API_TOKEN` 下发给员工或 AI 客户端。

---

## 二、整体架构

```text
员工 AI 客户端（Cursor / Claude Desktop 等）
    │
    ├─► 远程 MCP  https://<平台>/mcp  ──Bearer PAT──► NestJS /api/agent/*
    │
    └─► 本地 MCP  aim-mcp (stdio)  ──PAT + 钥匙串──► /api/agent/*
                              │
                              └─► 本机 Git（safe-git）──► Gitea SSH/HTTPS

员工终端
    └─► aim CLI  ──同上──► 平台 + 本机 Git + Gitea API（员工 PAT）
```

- **远程 MCP**：适合查需求、发沟通、看反馈、读 clone 地址；**不能**替你在磁盘上改代码。
- **本地 MCP / CLI**：在配置好的 `AIMANAGER_WORKSPACE` 下 clone、分支、提交、推送、建 PR（写操作要确认）。

---

## 三、管理员：部署平台 + 远程 MCP

### 3.1 前置条件

- 已按 [README](../README.md) 完成 PostgreSQL、Gitea、`deploy/gitea/init.sh`（`.env` 里 `GITEA_API_TOKEN` 非空）。
- 数据库迁移已包含 `integration_tokens`、`agent_audit_events`（容器启动时会 `prisma migrate deploy`）。

### 3.2 启动服务

```bash
# 在项目根目录
docker compose up -d --build api agent-mcp web caddy
```

`docker-compose.yml` 中：

- **api**：提供 `/api/agent/*` 与 PAT 校验。
- **agent-mcp**：运行 `aim-mcp-server`，监听容器内 `4100`，环境变量 `AIMANAGER_API_URL=http://api:4000/api`。
- **caddy**：把 `https://<APP>/mcp` 反代到 `agent-mcp:4100`（见根目录 `Caddyfile`）。

`.env` 可选：

```bash
AIM_MCP_PORT=4100   # agent-mcp 容器内端口，一般无需改
```

### 3.3 验收远程 MCP

```bash
# 未带令牌应 401
curl -i http://localhost:8080/mcp

# 带员工 PAT（先在 Web 个人资料创建）
curl -i -X POST http://localhost:8080/mcp \
  -H "Authorization: Bearer aim_你的令牌" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}'
```

局域网访问时，把 `localhost` 换成服务器 IP（须与 `APP_URL` / Caddy `APP_ADDR` 一致），例如 `http://172.17.200.46:8080/mcp`。

### 3.4 更新 MCP 服务

修改 `apps/agent-tools` 后：

```bash
docker compose up -d --build agent-mcp
# 若 API 也有变更
docker compose up -d --build api agent-mcp
```

### 3.5 发布 CLI 包（可选）

配置 `AIMANAGER_NPM_REGISTRY` 后，在 `apps/agent-tools`：

```bash
npm ci && npm run lint && npm test && npm run pack:check
npm version patch
npm publish --registry "$AIMANAGER_NPM_REGISTRY"
```

员工安装：`npm install -g @aimanager/agent-tools --registry "$AIMANAGER_NPM_REGISTRY"`。

---

## 四、员工：创建个人访问令牌

1. 浏览器登录平台 → **个人资料** → **AI 工具访问**。
2. 新建令牌，勾选所需 scope（建议按需最小权限）：
   - 只查列表：`read`
   - 发布/认领/沟通：`project:write`
   - 反馈：`feedback:write`
   - 读 clone 地址与权限：`git:metadata`
3. **明文只显示一次**，复制保存；泄露后立即在页面撤销。

浏览器 JWT **不能**代替 PAT 调用 Agent API；CLI/MCP 必须使用 `aim_` 开头的 PAT。

---

## 五、员工：安装与配置 CLI

### 5.1 安装方式

**方式 A — 内部 npm（推荐生产）**

```bash
npm install -g @aimanager/agent-tools --registry "$AIMANAGER_NPM_REGISTRY"
```

**方式 B — 源码（开发/内网未搭 Registry）**

```bash
cd apps/agent-tools
npm ci && npm run build
npm link    # 全局可用 aim、aim-mcp
```

### 5.2 首次配置

```bash
# 平台 API 根路径（含 /api）
aim config set api-url http://172.17.200.46:8080/api
aim config set gitea-url http://172.17.200.46:8081
aim config set gitea-org projects
aim config set workspace "$HOME/aimanager-workspaces"

# 保存 PAT（优先系统钥匙串）
export AIMANAGER_TOKEN='aim_...'   # 避免写进 shell 历史时可交互粘贴
aim auth login --token "$AIMANAGER_TOKEN"

# 需要 PR/CI/Release API 时，在 Gitea 用户设置里创建 PAT
aim auth gitea --token "$AIM_GITEA_TOKEN"

aim doctor
```

`aim doctor` 会检查 API 可达、`/api/agent/capabilities` 与 PAT 是否有效。

**无钥匙串的 Linux CI**：仅测试环境可 `export AIM_ALLOW_FILE_CREDENTIALS=true`，凭据落在 `~/.config/aimanager/credentials.json`（权限 `0600`）。

### 5.3 常用操作示例

```bash
# 看待办与通知摘要
aim --json project list --scope unclaimed

# 查看某需求完整上下文（沟通、成员、PR、成果）
aim project context <project-id>

# 认领并指定中文仓库展示名
aim project claim <project-id> --repo-display-name "报表自动导出"

# 克隆到工作区（元数据写入 .aimanager/project.json）
aim git clone <project-id>

cd "$HOME/aimanager-workspaces/<目录>"
aim git branch feature/export-report
aim git status

# 写操作：先拿 action id，再人工确认
aim git commit -m "feat: 导出 CSV"
aim approve <12位十六进制action-id>

aim git push
aim approve <action-id>

aim pr create --title "feat: 导出" --head feature/export-report
aim approve <action-id>
```

所有写 Git/PR/Release 的步骤都遵循同一规则：**AI 或脚本不能单独完成 `approve`**，必须由你在本机执行。

---

## 六、员工：配置 MCP

### 6.1 仅远程 MCP（只操作平台数据）

适合：在 Cursor 里查需求、发沟通、看反馈，**不涉及本机改代码**。

Cursor 用户级 MCP 配置示例（路径因版本而异，一般为 `~/.cursor/mcp.json` 或项目 `.cursor/mcp.json`）：

```json
{
  "mcpServers": {
    "aimanager-remote": {
      "url": "http://172.17.200.46:8080/mcp",
      "headers": {
        "Authorization": "Bearer aim_你的个人访问令牌"
      }
    }
  }
}
```

生产环境请改为 `https://` 与正式域名。**不要把 PAT 提交到 Git。**

### 6.2 本地 stdio MCP（平台 + 本机 Git）

适合：让 AI 在本地工作区 `git status`、clone、建分支、走确认流推送。

先完成 CLI 的 `auth login` / `auth gitea` 与 `config set`。

```json
{
  "mcpServers": {
    "aimanager-local": {
      "command": "aim-mcp",
      "env": {
        "AIMANAGER_API_URL": "http://172.17.200.46:8080/api",
        "AIMANAGER_GITEA_URL": "http://172.17.200.46:8081",
        "AIMANAGER_WORKSPACE": "/Users/你的用户名/aimanager-workspaces"
      }
    }
  }
}
```

若未 `npm link`，可把 `command` 改为 node 绝对路径：

```json
"command": "node",
"args": ["/path/to/aiManager/apps/agent-tools/dist/mcp-stdio.js"]
```

### 6.3 远程 + 本地同时开

可以同时配置 `aimanager-remote` 与 `aimanager-local`：远程查平台，本地做 Git。注意两个入口使用**同一套 PAT scope**。

### 6.4 MCP 工具一览

**平台（远程与本地均有）**

| 类型 | 工具名 |
| --- | --- |
| 只读 | `get_my_work`, `list_projects`, `get_project_context`, `get_deliverables`, `list_feedbacks`, `get_notifications`, `get_git_metadata` |
| 写 | `create_project`, `claim_project`, `join_development`, `post_update`, `create_feedback`, `comment_feedback`, `sync_project` |

**仅本地 companion**

| 类型 | 工具名 |
| --- | --- |
| 只读 | `git_status`, `git_diff`, `pr_status`, `ci_wait` |
| 写（需确认） | `clone_project`, `create_branch`, `commit_changes`, `push_branch`, `create_pull_request`, `prepare_release` |

**资源**：`aimanager://projects/{id}`、`aimanager://feedbacks/{id}`  

**提示词**：`implement_requirement`、`fix_feedback`、`prepare_release`

支持 **MCP elicitation** 的客户端会弹窗确认；否则工具返回 action id，你在终端执行 `aim approve <id>`。

---

## 七、推荐工作流（给同事的一句话版）

1. Web 上发布或认领需求 → 记下 `project-id`。
2. `aim git clone <project-id>` → 用 Cursor 打开该目录，启用 **aimanager-local** MCP。
3. 对 AI 说：「根据 `get_project_context` 实现需求，改完后用 `git_status` 给我看 diff，准备提交时等我 `aim approve`。」
4. 你在终端执行 `aim approve`，再 push / 建 PR。

---

## 八、常见问题

| 现象 | 处理 |
| --- | --- |
| `401` / `AUTH_REQUIRED` | PAT 错误、已撤销或过期；重新在个人资料创建 |
| `403` scope 不足 | 创建令牌时勾选对应 scope，或换权限更高的令牌 |
| `aim doctor` 失败 | 检查 `api-url`、网络、Docker 中 `api` 是否运行 |
| MCP 连上但 Git 失败 | 配置 `AIMANAGER_WORKSPACE`；clone 目录必须在 workspace 内；分支名需 `feature/` / `fix/` / `chore/` |
| 不能 push main | 设计如此；请走功能分支 + PR |
| 远程 MCP 不能改本地文件 | 预期行为；请加本地 `aim-mcp` 或改用 CLI |
| 局域网 unreachable | 检查客户端与服务器是否同网段、Wi‑Fi 是否客户端隔离；URL 使用服务器当前 IP 与 `:8080` |

排障时把 CLI/MCP 返回的 **request id** 交给管理员查 `agent_audit_events`，**不要**发送 PAT 或 Gitea 密码。

---

## 九、开发与维护者命令速查

```bash
# agent-tools
cd apps/agent-tools && npm ci && npm test

# 本地试远程 MCP 进程（一般不手工起，Compose 已起）
AIMANAGER_API_URL=http://127.0.0.1:8080/api AIM_MCP_PORT=4100 node dist/mcp-http.js

# API 能力
curl -s -H "Authorization: Bearer aim_xxx" http://localhost:8080/api/agent/capabilities | jq .
```

---

## 十、相关文档

- [cli.md](./cli.md) — 命令与参数细节  
- [mcp.md](./mcp.md) — MCP 协议与部署要点  
- [security.md](./security.md) — 令牌、Git 防护、审计  
- [operations.md](./operations.md) — 运维与升级  
- [development.md](./development.md) — 本地开发验证 agent-tools  
