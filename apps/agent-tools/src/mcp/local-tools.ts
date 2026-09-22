/**
 * 本地 MCP 工具注册
 * 作用：在共享平台工具之外提供受限工作区与 Git / PR / CI / Release 能力
 */
import { AgentClient } from '../client.js';
import { confirmationMessage, executePendingAction, requestApproval } from '../confirmation.js';
import { createGiteaClient } from '../gitea-client.js';
import { loadConfig } from '../config.js';
import { mcpError, mcpResult } from '../output.js';
import {
  cloneProject,
  createBranch,
  gitDiff,
  gitStatus,
  readProjectMetadata,
} from '../git/safe-git.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';

function cwdOf(cwd: string | undefined, workspaceRoot: string): string {
  return cwd ?? process.cwd() ?? workspaceRoot;
}

/** 注册本地文件系统和 Git 工具 */
export function registerLocalTools(server: McpServer, client: AgentClient): void {
  const config = loadConfig();

  server.registerTool(
    'git_status',
    {
      description: '查看受限工作区的 Git 状态',
      inputSchema: z.object({ cwd: z.string().optional() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ cwd }) => {
      try {
        return mcpResult(await gitStatus(cwdOf(cwd, config.workspaceRoot), config.workspaceRoot), '已获取 Git 状态。');
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'git_diff',
    {
      description: '查看受限工作区的 diff 摘要',
      inputSchema: z.object({ cwd: z.string().optional(), staged: z.boolean().optional() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ cwd, staged }) => {
      try {
        return mcpResult(await gitDiff(cwdOf(cwd, config.workspaceRoot), config.workspaceRoot, staged), '已获取 Git diff 摘要。');
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'clone_project',
    {
      description: '把项目克隆到配置的本地工作区，并写入项目元数据',
      inputSchema: z.object({ projectId: z.string().min(1), directory: z.string().optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ projectId, directory }) => {
      try {
        const info = await client.getProjectGit(projectId);
        const result = await cloneProject(info, config.workspaceRoot, directory);
        return mcpResult(result, `项目已克隆到 ${result.directory}。`);
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'create_branch',
    {
      description: '在当前工作区创建 feature/、fix/ 或 chore/ 分支',
      inputSchema: z.object({ cwd: z.string().optional(), branch: z.string().min(3).max(90) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ cwd, branch }) => {
      try {
        return mcpResult(await createBranch(cwdOf(cwd, config.workspaceRoot), config.workspaceRoot, branch), `分支 ${branch} 已创建。`);
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'commit_changes',
    {
      description: '准备提交本地变更；仅生成确认 action id，不会在确认前执行 commit',
      inputSchema: z.object({ cwd: z.string().optional(), message: z.string().min(1).max(200) }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ cwd, message }, extra) => {
      try {
        const directory = cwdOf(cwd, config.workspaceRoot);
        const status = await gitStatus(directory, config.workspaceRoot);
        const diff = await gitDiff(directory, config.workspaceRoot);
        const approval = await requestApproval(extra, 'commit', { cwd: directory, message });
        if (approval.approved && approval.action) {
          return mcpResult(await executePendingAction(approval.action), '已确认并提交本地代码。');
        }
        if (!approval.action) {
          return mcpResult({ approved: false }, '用户未确认，提交操作已取消。');
        }
        return mcpResult(
          { actionId: approval.action.id, status: status.stdout, diff: diff.stdout, confirmation: confirmationMessage(approval.action) },
          confirmationMessage(approval.action),
        );
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'push_branch',
    {
      description: '准备推送当前安全分支；仅生成确认 action id，不会在确认前执行 push',
      inputSchema: z.object({ cwd: z.string().optional(), branch: z.string().optional() }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ cwd, branch }, extra) => {
      try {
        const directory = cwdOf(cwd, config.workspaceRoot);
        const approval = await requestApproval(extra, 'push', { cwd: directory, branch });
        if (approval.approved && approval.action) {
          return mcpResult(await executePendingAction(approval.action), '已确认并推送代码。');
        }
        if (!approval.action) {
          return mcpResult({ approved: false }, '用户未确认，推送操作已取消。');
        }
        return mcpResult({ actionId: approval.action.id, confirmation: confirmationMessage(approval.action) }, confirmationMessage(approval.action));
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'create_pull_request',
    {
      description: '准备创建 Pull Request；仅生成确认 action id，不会在确认前调用 Gitea',
      inputSchema: z.object({
        cwd: z.string().optional(),
        title: z.string().min(4).max(120),
        body: z.string().max(10000).optional(),
        head: z.string().optional(),
        base: z.string().default('main'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ cwd, ...input }, extra) => {
      try {
        const directory = cwdOf(cwd, config.workspaceRoot);
        const metadata = readProjectMetadata(directory, config.workspaceRoot);
        const approval = await requestApproval(extra, 'pull_request', { cwd: directory, ...input, projectId: metadata.projectId });
        if (approval.approved && approval.action) {
          return mcpResult(await executePendingAction(approval.action), '已确认并创建 Pull Request。');
        }
        if (!approval.action) {
          return mcpResult({ approved: false }, '用户未确认，Pull Request 操作已取消。');
        }
        return mcpResult({ actionId: approval.action.id, confirmation: confirmationMessage(approval.action) }, confirmationMessage(approval.action));
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'pr_status',
    {
      description: '查询当前项目的 Pull Request',
      inputSchema: z.object({ cwd: z.string().optional(), state: z.enum(['open', 'closed', 'all']).optional() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ cwd, state }) => {
      try {
        const metadata = readProjectMetadata(cwdOf(cwd, config.workspaceRoot), config.workspaceRoot);
        const gitea = await createGiteaClient();
        return mcpResult(await gitea.listPullRequests(metadata.repoOwner, metadata.repoName, state), '已获取 Pull Request。');
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'ci_wait',
    {
      description: '查询当前项目最近的 CI 运行状态',
      inputSchema: z.object({ cwd: z.string().optional() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ cwd }) => {
      try {
        const metadata = readProjectMetadata(cwdOf(cwd, config.workspaceRoot), config.workspaceRoot);
        const gitea = await createGiteaClient();
        return mcpResult(await gitea.listActions(metadata.repoOwner, metadata.repoName), '已获取最近的 CI 运行状态。');
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'prepare_release',
    {
      description: '准备 Gitea Release；仅生成确认 action id，不会在确认前创建 Release',
      inputSchema: z.object({
        cwd: z.string().optional(),
        tagName: z.string().regex(/^v\d+\.\d+\.\d+(-[a-z0-9.-]+)?$/i),
        name: z.string().min(1).max(120),
        body: z.string().max(10000).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ cwd, tagName, name, body }, extra) => {
      try {
        const directory = cwdOf(cwd, config.workspaceRoot);
        const metadata = readProjectMetadata(directory, config.workspaceRoot);
        const approval = await requestApproval(extra, 'release', {
          cwd: directory,
          projectId: metadata.projectId,
          tagName,
          name,
          body,
        });
        if (approval.approved && approval.action) {
          return mcpResult(await executePendingAction(approval.action), '已确认并准备 Release。');
        }
        if (!approval.action) {
          return mcpResult({ approved: false }, '用户未确认，Release 操作已取消。');
        }
        return mcpResult({ actionId: approval.action.id, confirmation: confirmationMessage(approval.action) }, confirmationMessage(approval.action));
      } catch (error) {
        return mcpError(error);
      }
    },
  );
}
