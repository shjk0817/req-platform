# 本地开发指南

## 一、目录与职责

| 目录 | 说明 |
| --- | --- |
| `apps/api` | NestJS 后端：认证、用户、需求/项目、反馈、Gitea 集成、通知、定时任务 |
| `apps/web` | Next.js 前端：登录注册、需求池、项目看板、反馈、通知、后台用户管理 |
| `deploy/` | Gitea / Runner 配置、仓库模板与流水线模板 |
| `scripts/` | 端到端验收脚本 |

## 二、本地起后端（连容器里的数据库）

```bash
# 1. 只启动基础设施
docker compose up -d postgres redis gitea

# 2. 本地跑后端（宿主机直连端口需要临时暴露，或改用容器内地址）
cd apps/api
npm install
cp ../../.env.example ../../.env   # 首次
# 修改 DATABASE_URL / REDIS_HOST 指向本机可访问的地址
npx prisma migrate deploy
npm run start:dev                   # http://localhost:4000/api
```

## 三、本地起前端

```bash
cd apps/web
npm install
NEXT_PUBLIC_API_URL=http://localhost:4000/api npm run dev   # http://localhost:3000
```

## 四、编码约定

- 每个文件开头写有效的中文注释，说明该文件的职责。
- 每个函数/方法写中文注释，说明参数与作用；对外接口的 DTO 字段带 `@ApiProperty` 描述。
- 后端分层：`controller`（HTTP 与鉴权）→ `service`（业务）→ `prisma`/`gitea`（数据与外部系统）。
- 与 Gitea 的所有交互统一走 `GiteaService`，不要散落在业务代码里。
- 头像、状态色、文案等展示口径集中放在 `lib/labels.ts`、`lib/avatars.ts`，页面里不要硬编码。
- 预设头像标识必须前后端各维护一份并保持一致：
  `apps/api/src/common/constants/avatars.ts`（校验）↔ `apps/web/lib/avatars.ts`（渲染）。

## 五、常用命令

```bash
# 后端
cd apps/api
npm run start:dev          # 开发模式
npm run build              # 编译
npx prisma migrate dev     # 本地改模型后生成迁移
npx prisma studio          # 可视化查看数据

# 前端
cd apps/web
npm run dev
npm run build

# 全栈
docker compose up -d --build api web
bash scripts/e2e-test.sh
```

## 六、改数据模型

1. 修改 `apps/api/prisma/schema.prisma`。
2. `cd apps/api && npx prisma migrate dev --name <描述>`（需要能连到数据库）。
3. 提交生成的 `prisma/migrations/*`；容器启动时会自动执行 `prisma migrate deploy`。

## 七、新增一个 Gitea 集成能力

1. 在 `apps/api/src/gitea/gitea.service.ts` 增加方法，统一用 `this.request()` 发起请求
   （自动带 Token、自动把错误转成 `GiteaApiError`）。
2. 若涉及事件回写，在 `gitea-webhook.service.ts` 的 `dispatch()` 中增加分支，
   并在 `dto/gitea-webhook.dto.ts` 声明载荷类型。
3. 若需要新增 Webhook 事件，注意 Gitea 1.22 支持的事件有限
   （详见 `docs/architecture.md` 的集成点说明），必要时改用工作流回调 `POST /api/webhooks/ci`。

## 八、调试流水线

```bash
# Runner 日志（改 config.yaml 后需要 --force-recreate 才生效）
docker compose up -d --force-recreate gitea-runner
docker compose logs -f gitea-runner

# Gitea 侧的任务状态与日志
docker compose exec postgres psql -U aimanager -d gitea \
  -c 'select id, status, started, stopped, log_filename from action_task order by id desc limit 5;'
docker compose exec gitea sh -c 'ls /data/gitea/actions_log/projects/<repo>/'

# Runner 的 Action 缓存损坏时（报 MODULE_NOT_FOUND / non-fast-forward），清掉重启
docker exec aimanager-gitea-runner rm -rf /root/.cache/act
docker compose restart gitea-runner
```
