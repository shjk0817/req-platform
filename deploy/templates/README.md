# 通用 CI/CD 流水线模板索引

本目录存放平台在「新建项目仓库」时可选注入的流水线模板，
`repo-template` 目录则是仓库初始内容模板（含 `README`、`CONTRIBUTING`、
`PR/Issue 模板` 与默认流水线）。

## 模板清单

| 模板 | 适用场景 | 说明 |
| --- | --- | --- |
| `nodejs-ci.yml` | Node.js / TypeScript 项目 | lint + test + build |
| `nodejs-release.yml` | 需要发布产物的项目 | 打 `v*` 标签时构建并创建 Release |
| `docker-ci.yml` | 需要交付容器镜像的项目 | 构建镜像并推送到内部镜像仓库 |
| `static-deploy.yml` | 静态站点 / 前端项目 | 构建后发布静态文件产物 |

## 使用方式

1. 新建项目时由平台自动从 `repo-template` 初始化，默认包含 `ci.yml` 与 `release.yml`。
2. 如需其他模板，把对应 yml 复制到项目仓库的 `.gitea/workflows/` 目录即可。
3. 所有模板均遵循 GitHub Actions 语法，可在 Gitea Actions 中直接运行。

## 占位符说明

| 占位符 | 含义 |
| --- | --- |
| `__REGISTRY__` | 内部镜像仓库地址 |
| `__DEPLOY_TARGET__` | 静态产物发布目标目录 |
