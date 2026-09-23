# aim CLI

`aim` 是员工使用平台、Git、Pull Request、CI 和 Release 的统一命令行入口。它只使用员工自己的平台个人访问令牌和 Gitea PAT，不会下发平台管理员 Gitea Token。

## 使用前准备

- Node.js 20+、npm，以及可访问平台地址的网络环境。
- 平台账号已通过管理员审核，并在个人资料页创建平台 PAT。
- 需要执行 PR / CI / Release API 操作时，在 Gitea 个人设置中创建员工自己的 PAT。
- 需要 clone / push 时，优先配置 SSH Agent；HTTPS 只使用员工自己的 Gitea 凭据。

平台 PAT 至少需要 `read`；发布需求、认领或沟通需要 `project:write`；反馈操作需要
`feedback:write`；读取仓库元数据需要 `git:metadata`。个人令牌明文只显示一次。

## 安装与首次配置

从公司内部 npm Registry 安装：

```bash
npm install -g @aimanager/agent-tools --registry "$AIMANAGER_NPM_REGISTRY"
aim config set api-url https://app.example.com/api
aim config set gitea-url https://git.example.com
aim config set gitea-org projects
aim config set workspace "$HOME/aimanager-workspaces"
```

令牌通过个人资料页「AI 工具访问」创建，明文只显示一次。优先保存到系统钥匙串：

```bash
aim auth login --token "$AIMANAGER_TOKEN"
aim auth gitea --token "$AIM_GITEA_TOKEN"
aim doctor
```

`aim doctor` 会检查 Agent API 能力声明、当前 PAT 和工作区配置，但不会输出完整令牌。
生产环境不要使用 `AIM_ALLOW_FILE_CREDENTIALS=true`；该变量只用于无系统钥匙串的临时
测试环境。配置文件位于 `~/.config/aimanager/config.json`，凭据降级文件位于同目录
的 `credentials.json`，权限应为 `0600`。

在没有系统钥匙串的测试环境中，必须显式设置 `AIM_ALLOW_FILE_CREDENTIALS=true`，文件会保存到 `~/.config/aimanager/credentials.json` 并设置为 `0600`。

## 常用命令

```bash
aim project list --scope unclaimed
aim project context <project-id>
aim project create --title "报表自动导出" --description "..."
aim project claim <project-id> --repo-display-name "报表自动导出"
aim project join <project-id>
aim feedback list --scope assigned
aim git clone <project-id>
aim git status --cwd "$HOME/aimanager-workspaces/report-tool"
aim git branch feature/export-report
aim pr list
aim ci status
```

`--json` 可输出稳定的结构化结果，适合脚本和 AI 继续处理：

```bash
aim --json project list --scope developing
```

CLI 与 Agent API 的错误都包含稳定 `code` 和 request id；排障时请把 request id
提供给平台管理员，不要直接提供令牌或完整请求头。

## 写操作确认

`commit`、`push`、创建 PR 和 Release 不会直接执行。命令会先输出 10 分钟有效的 action id：

```bash
aim git commit -m "fix: 修复导出编码"
aim approve <action-id>
```

本地工作区只允许位于 `workspace` 配置目录内；功能分支必须以 `feature/`、`fix/` 或 `chore/` 开头；禁止直接推送 `main`、force push、mirror 和带凭据的远程地址。

## MCP companion

让 Cursor、Claude 或其他本地 MCP 客户端启动：

```bash
aim mcp serve
```

stdio 配置示例：

```json
{
  "mcpServers": {
    "aimanager": {
      "command": "aim-mcp",
      "env": {
        "AIMANAGER_API_URL": "https://app.example.com/api"
      }
    }
  }
}
```

## 发布新版本

维护者在 `apps/agent-tools` 目录执行：

```bash
npm ci
npm run lint
npm test
npm run pack:check
npm version patch
npm publish --registry "$AIMANAGER_NPM_REGISTRY"
```

发布前必须完成平台 API、MCP 协议和真实 Gitea E2E 验收；版本号变更后重新构建
`agent-mcp` Docker 镜像。员工升级后建议再次运行 `aim doctor`。
