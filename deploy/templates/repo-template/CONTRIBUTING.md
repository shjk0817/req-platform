# 协作规范

本仓库由「内部需求协作平台」创建，所有开发协作均按以下流程进行。

## 1. 角色

| 角色 | 说明 |
| --- | --- |
| 需求方（Creator） | 在平台提出需求，验收成果并提交反馈 |
| 项目负责人（Owner） | 认领项目、拆分任务、评审 PR、负责发布 |
| 协作者（Collaborator） | 参与开发，提交 PR |
| 评审人（Reviewer） | 至少一名非作者成员评审通过后才可合并 |

## 2. 分支规范

- `main`：稳定分支，只接受通过 CI 与评审的 PR 合并，禁止直接推送
- `feature/<简短描述>`：新功能
- `fix/<简短描述>`：缺陷修复
- `chore/<简短描述>`：构建、依赖、文档等杂项

## 3. 提交信息规范

采用 Conventional Commits：

```
<type>(<scope>): <subject>

<body>

<footer>
```

`type` 取值：`feat` / `fix` / `docs` / `style` / `refactor` / `perf` / `test` / `build` / `ci` / `chore`

## 4. Pull Request 要求

1. PR 标题同样遵循提交信息规范
2. 描述中关联需求单或 Issue（例如 `Closes #12`）
3. 必须通过全部 CI 检查
4. 至少一条有效评审意见并解决后才可合并
5. 合并后自动删除源分支

## 5. CI/CD 说明

流水线定义在 `.gitea/workflows/`：

| 文件 | 触发条件 | 作用 |
| --- | --- | --- |
| `ci.yml` | push / pull_request | 安装依赖、代码检查、单元测试、构建 |
| `release.yml` | 推送 `v*` 标签 | 构建产物并发布 Release |

## 6. 反馈迭代

需求方在平台上提交反馈后，平台会自动创建 Issue。开发者修复后在提交信息中
引用该 Issue 编号（`fix: 修复导出乱码 (#12)`），合并后 Issue 自动关闭。
