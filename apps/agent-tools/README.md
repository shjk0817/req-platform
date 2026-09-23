# @aimanager/agent-tools

员工侧 `aim` CLI、远程 Streamable HTTP MCP 与本地 stdio MCP companion。
该包只使用员工自己的平台 PAT、Gitea PAT 或 SSH Agent，不包含平台管理员密钥。

## 本地构建与测试

要求 Node.js 20+ 与 npm：

```bash
npm ci
npm run lint
npm test
npm run pack:check
```

`npm test` 会执行 Git 安全测试、Agent API 客户端协议测试、CLI 命令测试和
Streamable HTTP MCP initialize 握手测试。测试不会连接真实数据库或 Gitea。

## 打包与内部发布

发布前确认版本号、变更记录和兼容的 MCP 客户端版本，然后执行：

```bash
npm version patch
npm run pack:check
npm publish --registry "$AIMANAGER_NPM_REGISTRY"
```

生产发布必须使用公司内部 npm Registry；不要把包发布到公共 Registry，也不要把 PAT
写入命令行历史。员工安装后运行：

```bash
npm install -g @aimanager/agent-tools --registry "$AIMANAGER_NPM_REGISTRY"
aim doctor
```

远程 MCP 服务由仓库根目录的 Docker Compose 构建，不依赖员工安装 npm 包。
