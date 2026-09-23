# 部署与运维

> 面向单机 Docker Compose 部署（适合 100 人以内的内部团队）。

## 一、部署前准备

| 依赖 | 说明 |
| --- | --- |
| Docker 24+ / Docker Compose v2 | 建议 4 核 8G 以上，磁盘 ≥ 50G（含镜像与仓库数据） |
| 域名 | 建议 `app.公司域名`（平台）与 `git.公司域名`（Gitea）；无域名时可用 `*.localhost` 本地验证 |
| 端口 | 默认占用 80/443；若已被占用，用 `CADDY_HTTP_PORT` / `CADDY_HTTPS_PORT` 改端口 |
| 邮件服务 | 可选，用于注册审核与通知邮件（`MAIL_ENABLED=true` 时生效） |

## 二、首次部署

```bash
# 1. 准备环境变量
cp .env.example .env
vi .env     # 必须修改：POSTGRES_PASSWORD / REDIS_PASSWORD / JWT_SECRET /
            #          GITEA_ADMIN_PASSWORD / GITEA_WEBHOOK_SECRET / ADMIN_PASSWORD

# 2. 启动基础设施（数据库 / 缓存 / Gitea）
docker compose up -d postgres redis gitea

# 3. 一键初始化 Gitea（管理员、组织、API Token、Runner 令牌、仓库模板）
chmod +x deploy/gitea/init.sh
./deploy/gitea/init.sh

# 4. 重启 Runner 完成注册
docker compose restart gitea-runner

# 5. 启动平台与远程 MCP
docker compose up -d --build api agent-mcp web caddy

# 6. 检查
docker compose ps
curl -s http://app.localhost/api/health   # 返回 {"status":"ok"} 即正常
```

访问 `http://app.localhost`，用 `.env` 中的 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 登录。

### 局域网访问（IP 会变）

Docker 默认已在宿主机 **`0.0.0.0:8080` / `8081`** 上暴露端口；不必为每个新 IP 改 `APP_ADDR`。

推荐在 `.env` 中让 Caddy **按容器内端口监听、接受任意 Host**：

```bash
APP_ADDR=:80
GITEA_ADDR=:8081
CADDY_HTTP_PORT=8080          # 宿主机访问 http://<任意可达IP>:8080
CADDY_GITEA_HTTP_PORT=8081    # Git 服务 http://<同一IP>:8081
APP_URL=http://localhost:8080 # 本机；邮件/通知里的绝对链接可仍用 localhost 或固定域名
GITEA_ROOT_URL=http://localhost:8081/
```

同事用 **`http://<服务器当前局域网 IP>:8080`** 打开即可，无需再改 `APP_ADDR`。  
**SSO 仍要求平台与 Git 使用同一主机名**（例如都用 `172.17.200.46`，不要平台用 IP、Git 用 `localhost`）。  
API 返回的 clone 链接仍来自 `GITEA_ROOT_URL`；若需链接里显示当前 IP，可把 `APP_URL` / `GITEA_ROOT_URL` 改成该 IP 后 `docker compose up -d`（或改用固定内网 DNS）。

### 端口被占用时

```bash
# .env
CADDY_HTTP_PORT=8080
CADDY_HTTPS_PORT=8443
APP_ADDR=app.localhost
GITEA_ADDR=git.localhost
APP_URL=http://app.localhost:8080
API_URL=http://app.localhost:8080
GITEA_ROOT_URL=http://git.localhost:8080/
```

修改后执行 `docker compose up -d caddy`，并把 `GITEA_ROOT_URL` 同步给平台（Gitea 内部回调地址不受影响）。

### 使用真实域名 + HTTPS

```bash
APP_ADDR=app.example.com
GITEA_ADDR=git.example.com
ACME_EMAIL=ops@example.com
APP_URL=https://app.example.com
API_URL=https://app.example.com
GITEA_ROOT_URL=https://git.example.com/
```

Caddy 会自动申请并续期证书。

## 三、初始化脚本做了什么

`deploy/gitea/init.sh` 可重复执行（幂等）：

1. 等待 Gitea 就绪；创建管理员 `GITEA_ADMIN_USER`。
2. 创建组织 `GITEA_ORG`（默认 `projects`），所有项目仓库归属该组织。
3. 生成平台 API Token（含 `write:admin` 等权限）并写回 `.env` 的 `GITEA_API_TOKEN`。
4. 生成 act_runner 注册令牌到 `deploy/runner/.registration-token`。
5. 把 `deploy/templates/repo-template` **强制同步**到模板仓库 `projects/repo-template`
   并标记为模板仓库。

> 修改了 `deploy/templates/repo-template` 后，重新执行 `./deploy/gitea/init.sh` 即可同步模板；
> 只影响之后新建的仓库，已建仓库需按需手工更新。

## 四、流水线（CI/CD）说明

- Runner 配置见 `deploy/runner/config.yaml`，其中 `container.network: aimanager_backend`
  让任务容器加入平台网络，从而能解析 `gitea` / `api` 并拉取代码、回调平台。
  改了该文件需要 `docker compose up -d --force-recreate gitea-runner` 才生效。
- 仓库模板中的 CI 由 `push`（非 main 分支）与 `pull_request` 触发，Release 由 `v*` 标签触发。
- **流水线状态回写**：工作流结束时以 `X-CI-Token` 回调 `POST /api/webhooks/ci`，
  平台据此更新 PR 的 `ciStatus` 并通知作者。
  - 回调地址与令牌由平台在建仓时写入仓库的 workflow 文件（`__CI_CALLBACK_URL__` 占位符替换）。
  - 令牌默认复用 `GITEA_WEBHOOK_SECRET`，也可用 `CI_CALLBACK_TOKEN` 单独指定。
  - 平台对外只暴露 `app.域名/api`，回调走容器内网 `http://api:4000`，无需公网可达。
- 模板刻意不使用 GitHub Marketplace 的 Action，全部用 shell + Gitea API 完成，
  保证内网环境（无 github.com 出口）也能跑通。

## 五、日常运维

```bash
# 查看状态与日志
docker compose ps
docker compose logs -f api
docker compose logs -f gitea-runner
# 更新平台代码后重建
git pull
docker compose up -d --build api web

# 数据库结构变更（Prisma 迁移在后端容器启动时自动执行 prisma migrate deploy）
docker compose exec api npx prisma migrate deploy

# 备份（数据库 + 仓库 + 附件）
docker compose exec -T postgres pg_dump -U $POSTGRES_USER $POSTGRES_DB > backup-$(date +%F).sql
docker run --rm -v aimanager_gitea-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/gitea-data-$(date +%F).tgz -C /data .
```

### 演示数据（seed）

空库只有管理员账号，页面比较冷清；对外演示或交接前建议写入一整套演示数据：

```bash
# 清理 E2E 测试数据 + 重建演示数据（可重复执行，结果一致）
docker compose exec -T api npm run seed:demo
```

脚本写入的内容与清理规则：

| 步骤 | 说明 |
| --- | --- |
| 清理 | 删除 `*@e2e.example.com`（E2E 测试账号，另有历史遗留的 `requester-数字@example.com`）与脚本登记的演示账号；同事自己注册的账号不受影响 |
| 写入 | 20 位同事、21 个需求（待认领 5 / 已认领 2 / 开发中 5 / 已交付 8 / 已关闭 1）、反馈与讨论、PR、附件、通知；时间打散到过去 11 个月，用于展示热力图 |
| 同步 Git | 按模板创建 15 个项目仓库，配置 Webhook 与流水线回调，把反馈同步成带标签的真实 Issue |

- `--keep-e2e`：保留 E2E 测试账号，只重建演示数据；
- `--skip-gitea`：只写数据库（Gitea 未就绪时用）；
- 演示账号密码统一为 `Demo@123456`，可用环境变量 `DEMO_PASSWORD` 覆盖；
- 附件是真实落盘文件（`uploads-data` 卷），脚本会写入体积很小的占位图，不依赖外网图片。

> 脚本会把管理员邮箱对齐到 `.env` 的 `ADMIN_EMAIL`（默认 `admin@aimanager.com`），
> 老环境从 `admin@example.com` 升级过来时会自动改名，登录请改用新邮箱。

## 六、升级

```bash
# 1. 备份（见上）
# 2. 拉取新镜像/代码并滚动更新
docker compose pull
docker compose up -d --build
# 3. Gitea 大版本升级前先看官方 Release Note，跨版本需逐级升级
```

### MCP / CLI 发布

- 远程 MCP 随 `agent-mcp` 镜像发布，更新 `apps/agent-tools` 后执行
  `docker compose up -d --build agent-mcp`。
- 员工 CLI 与本地 MCP 由 `apps/agent-tools` 打包到公司内部 npm Registry；
  发布前依次执行 `npm run lint`、`npm test`、`npm run pack:check`，再执行
  `npm version patch` 和 `npm publish --registry "$AIMANAGER_NPM_REGISTRY"`。
- 发布后用员工测试 PAT 执行 `aim doctor`，并用 MCP 客户端完成一次只读工具调用；
  不要用平台管理员 `GITEA_API_TOKEN` 作为员工凭据。

## 七、常见问题排查

| 现象 | 排查步骤 |
| --- | --- |
| 审核通过但没开通 Git 账号 | 看 `docker compose logs api` 是否有 `403 ... required scope`；确认 `GITEA_API_TOKEN` 含 `write:admin`（删掉 `.env` 中该行后重跑 `init.sh` 可重新生成） |
| 认领后没建仓 | 确认 `GITEA_API_TOKEN` 非空、模板仓库存在（`./deploy/gitea/init.sh`），项目详情页可点「立即创建」重试 |
| PR 状态没同步 | Gitea 仓库 Settings → Web Hooks 查看投递记录；确认 `GITEA_WEBHOOK_SECRET` 与平台一致；项目详情页可点「同步仓库 PR」手动补齐 |
| CI 不执行 | `docker compose logs gitea-runner` 确认 Runner 已注册；仓库需存在 `.gitea/workflows/ci.yml`；Gitea 需开启 Actions（`GITEA__actions__ENABLED=true`） |
| CI 执行失败在「拉取代码」 | 任务容器网络不通：确认 `deploy/runner/config.yaml` 的 `container.network` 与 compose 网络名（`<项目名>_backend`）一致，并重启 Runner |
| 平台 PR 上 CI 状态一直不变 | 确认 workflow 文件中 `CI_CALLBACK_URL` / `CI_CALLBACK_TOKEN` 已替换（非 `__CI_CALLBACK_*__`），且 `api` 容器可达 |
| 收不到邮件 | `MAIL_ENABLED=false` 时只记日志不发信；站内通知不受影响 |
| 80 端口被占用 | 设置 `CADDY_HTTP_PORT` / `CADDY_HTTPS_PORT` 换端口 |
| 点「代码仓库」提示「Git 账号尚未开通」 | 该用户 `giteaUsername` 为空：管理员在「用户审核」里审核通过即会开通；初始管理员由启动引导自动绑定 `GITEA_ADMIN_USER` |
| 点「代码仓库」后仍停在 Gitea 登录页 | ① 平台与 Git 服务必须同一主机名（Cookie 只按主机名共享），检查 `APP_URL` 与 `GITEA_ROOT_URL`，不要用 `app.localhost` + `git.localhost` 这种组合；② `docker compose exec gitea grep -n REVERSE_PROXY /data/gitea/conf/app.ini`，`REVERSE_PROXY_AUTHENTICATION_USER` 必须在 `[security]` 段；③ 检查 Caddyfile 的 `@gitea_bypass` 是否把静态资源、`/api/*`、`/user/login`、`*.git` 都放行（必须写成一条正则，多行会被按「与」处理） |
| 直接打开 Git 地址会被弹回平台登录页 | 属于预期行为：SSO Cookie 缺失或已过期。平台在「登录成功」「恢复登录态」时会自动补签发；被弹回时 `gitea-verify` 会带 `?redirect=<原始 Git 地址>`，登录后会自动跳回原页面 |
| 从平台点进 Git 服务，回来时落在工作台而不是原来的仓库页 | 确认 `GET /api/auth/gitea-verify` 的 302 里带上了 `redirect` 参数；该地址由 Caddy `forward_auth` 透传的 `X-Forwarded-Proto/Host/Uri` 还原 |
| 匿名访问 Git 服务直接跳平台登录页 | 属于预期行为：`Caddy forward_auth` 会先校验平台登录态，未登录时引导回 `/login` |
| 头像显示成动物 emoji / 还是旧头像 | 头像已统一改为内置人物插画：`apps/web/lib/avatars.ts` 的 `USER_AVATARS` 提供 18 个人物，标识（`user-01`…`user-18`）未变，已保存的取值会自动渲染成新插画，无需重新选择 |
| 页面上还有「需求方1712…」这类测试账号 | 老版本 E2E 脚本留下的数据：`docker compose exec -T api npm run seed:demo` 会清理并重建演示数据；只想清理不重建可加 `--keep-e2e` 之外的方案见上节 |
| 演示数据里出现的同事邮箱域名不对 | 演示域名取自 `.env` 的 `ADMIN_EMAIL`，改完重新执行 `npm run seed:demo` 即可 |
| Gitea 用户名/仓库名还是 `xxx_1a2b` 这种随机串 | 老账号是用旧规则创建的，重新审核或重建仓库即会按拼音规则生成；已存在的账号名不会自动改写 |
| PR 里显示的用户名与平台姓名对不上 | Gitea 用户名是姓名拼音（张伟 → `zhangwei`），与平台展示的中文姓名不同属正常 |

## 八、验收脚本

`scripts/e2e-test.sh` 覆盖完整闭环，可随时回归：

```bash
bash scripts/e2e-test.sh
```

覆盖内容：

1. 管理员登录
2. 两位同事注册（同一账号既能提需求也能认领开发，使用真实姓名与 `e2e.example.com` 测试域名）
3. 管理员审核 -> 自动开通 Gitea 账号
4. 两位同事登录
5. 提出需求
6. 另一位同事认领 -> 自动建仓（含模板文件与 Webhook）
7. 推送分支 + 创建 PR -> Webhook 同步 PR、项目转为开发中、**真实流水线运行并回写 CI 状态**
8. 提交反馈 -> 自动创建 Gitea Issue
9. 平台回复 + 标记已解决 -> Issue 自动关闭
10. 添加协作者 -> 仓库权限同步
11. 站内通知与统计数据
12. 任务头像 / 需求池头像与完成进度
13. 共同需求人（管理员代加 / 自助加入 / 自助退出 / 越权被拒）
14. 协作热力图（全平台 / 个人）
15. 需求图片与附件（上传 / 在线预览 / 下载 / 列表附件数）
16. Git 服务免密登录（SSO / 被弹回后带回原地址）与品牌定制（Logo / 登录页）

脚本开头会等待 `/api/health` 就绪（最多 60 秒），避免服务刚重启时误报。
测试账号使用真实姓名与专用域名 `e2e.example.com`（邮箱局部带时间戳保证唯一），
`npm run seed:demo` 会按域名精确清理，不会与演示数据混淆。
