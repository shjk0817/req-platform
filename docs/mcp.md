# aiManager MCP

系统提供两个 MCP 入口：

- 远程 `https://app.example.com/mcp`：只操作平台需求、沟通、反馈、通知、成果和 Git 元数据。
- 本地 `aim-mcp`：在远程工具之外操作员工明确配置的本地工作区，以及员工自己的 Git / Gitea PAT。

clone、commit、push 不经过平台后端；平台只返回项目上下文、clone 地址、权限和审计。远程 MCP 与本地 MCP 都通过 Bearer 个人访问令牌调用 `/api/agent/*`。

## 管理员部署远程 MCP

先执行根目录的初始化脚本并配置 `GITEA_API_TOKEN`，再启动 API、远程 MCP 和 Caddy：

```bash
cp .env.example .env
./deploy/gitea/init.sh
docker compose up -d --build api agent-mcp web caddy
curl -i http://localhost:8080/mcp
```

未携带 `Bearer aim_...` 时应返回 `401 AUTH_REQUIRED`。远程 MCP 容器只持有平台
Agent API 地址，不持有平台管理员 Gitea Token。生产环境应通过 HTTPS 暴露 `/mcp`，
并限制平台 PAT 的创建 scope 与有效期。

## 远程客户端配置

```json
{
  "mcpServers": {
    "aimanager-remote": {
      "url": "https://app.example.com/mcp",
      "headers": {
        "Authorization": "Bearer <员工个人访问令牌>"
      }
    }
  }
}
```

不要把令牌提交到仓库、工作流、截图或聊天记录。令牌可在平台个人资料页撤销，撤销后远程 MCP 和 CLI 会立即收到 `AUTH_REQUIRED` / `401`。

远程 MCP 适合不需要访问本地文件的客户端；需要查看工作区、执行 Git 或创建 PR
时，还要在员工终端配置本地 stdio companion：

```json
{
  "mcpServers": {
    "aimanager-local": {
      "command": "aim-mcp",
      "env": {
        "AIMANAGER_API_URL": "https://app.example.com/api",
        "AIMANAGER_WORKSPACE": "~/aimanager-workspaces"
      }
    }
  }
}
```

本地 companion 读取系统钥匙串中的平台 PAT 与 Gitea PAT；首次使用前执行
`aim auth login`、`aim auth gitea` 和 `aim doctor`。

## 平台工具

只读能力包括 `get_my_work`、`list_projects`、`get_project_context`、`get_deliverables`、`list_feedbacks`、`get_notifications` 和 `get_git_metadata`。

写能力包括 `create_project`、`claim_project`、`join_development`、`post_update`、`create_feedback`、`comment_feedback` 和 `sync_project`。工具返回简洁文本与 `structuredContent`，错误包含稳定 `code` 和 `requestId`。

资源：

- `aimanager://projects/{id}`
- `aimanager://feedbacks/{id}`

提示词：

- `implement_requirement`
- `fix_feedback`
- `prepare_release`

所有工具都声明 `readOnlyHint`、`destructiveHint` 和 `idempotentHint`，客户端可以据此决定展示和确认策略。

工具错误同时包含人类可读文本、稳定 `code` 与 request id。客户端应优先按 `code`
处理错误，不要依赖中文提示文本。

## 本地工具

本地 companion 额外提供 `git_status`、`git_diff`、`clone_project`、`create_branch`、`commit_changes`、`push_branch`、`create_pull_request`、`pr_status`、`ci_wait` 和 `prepare_release`。

支持 elicitation 的 MCP 客户端会弹出原生确认；不支持时，工具只生成短时 action id，员工必须在本机执行 `aim approve <id>`。AI 无法通过工具参数自行绕过确认。

## 协议验收

在 `apps/agent-tools` 中执行：

```bash
npm ci
npm test
```

其中包含真实 SDK 的 Streamable HTTP `initialize` 握手测试；它使用临时 HTTP 服务，
不会修改平台数据。部署后的最低探测命令是：

```bash
curl -i http://localhost:8080/mcp
```

预期未认证响应为 `401`，而不是把 MCP 服务错误地暴露为普通网页。
