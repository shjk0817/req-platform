/**
 * 平台 MCP 工具注册
 * 作用：远程 MCP 与本地 companion 共用稳定的需求、反馈、通知与成果能力
 */
import { AgentClient } from '../client.js';
import { mcpError, mcpResult } from '../output.js';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';

/** 注册远程平台工具、资源和工作流提示词 */
export function registerPlatformTools(server: McpServer, client: AgentClient): void {
  server.registerTool(
    'get_my_work',
    {
      description: '获取当前员工的待办、未读通知和待处理反馈',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => {
      try {
        const data = await client.getMyWork();
        return mcpResult(data, '已获取你的工作上下文。');
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'list_projects',
    {
      description: '查询需求池，可按状态、范围和关键字筛选',
      inputSchema: z.object({
        scope: z.enum(['all', 'mine', 'created', 'unclaimed', 'developing', 'requesting']).optional(),
        status: z.enum(['OPEN', 'CLAIMED', 'DEVELOPING', 'RELEASED', 'CLOSED']).optional(),
        keyword: z.string().optional(),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (input) => {
      try {
        const data = await client.listProjects(input);
        return mcpResult(data, '已获取需求列表。');
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'get_project_context',
    {
      description: '获取需求、沟通记录、成员、反馈、PR 与成果上下文',
      inputSchema: z.object({ projectId: z.string().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ projectId }) => {
      try {
        return mcpResult(await client.getProjectContext(projectId), '已获取项目完整上下文。');
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'get_deliverables',
    {
      description: '获取项目 README、使用教程、成果展示和 Release 下载',
      inputSchema: z.object({ projectId: z.string().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ projectId }) => {
      try {
        return mcpResult(await client.getDeliverables(projectId), '已获取项目成果。');
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'list_feedbacks',
    {
      description: '查询与当前员工相关的反馈',
      inputSchema: z.object({
        scope: z.enum(['mine', 'assigned']).optional(),
        status: z.enum(['OPEN', 'PROCESSING', 'RESOLVED', 'CLOSED']).optional(),
        projectId: z.string().optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (input) => {
      try {
        return mcpResult(await client.listFeedbacks(input), '已获取反馈列表。');
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'get_notifications',
    {
      description: '获取当前员工的站内通知',
      inputSchema: z.object({ page: z.number().int().min(1).optional(), pageSize: z.number().int().min(1).max(100).optional() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (input) => {
      try {
        return mcpResult(await client.getNotifications(input), '已获取通知。');
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'get_git_metadata',
    {
      description: '获取项目的 SSH/HTTP clone 地址、默认分支和当前用户权限，不返回任何密钥',
      inputSchema: z.object({ projectId: z.string().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ projectId }) => {
      try {
        return mcpResult(await client.getProjectGit(projectId), '已获取项目 Git 元数据。');
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'create_project',
    {
      description: '发布一个需求，只需标题和需求详情；执行前请确认内容将对同事可见',
      inputSchema: z.object({
        title: z.string().min(4).max(120),
        description: z.string().min(10).max(5000),
        imageIds: z.array(z.string()).max(12).optional(),
        attachmentIds: z.array(z.string()).max(20).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (input) => {
      try {
        return mcpResult(await client.createProject(input), '需求已发布。');
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'claim_project',
    {
      description: '认领一个开放需求并创建对应仓库',
      inputSchema: z.object({
        projectId: z.string().min(1),
        repoName: z.string().max(100).optional(),
        repoDisplayName: z.string().max(120).optional(),
        remark: z.string().max(500).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ projectId, ...input }) => {
      try {
        return mcpResult(await client.claimProject(projectId, input), '需求已认领。');
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'join_development',
    {
      description: '加入已有负责人的项目开发协作',
      inputSchema: z.object({ projectId: z.string().min(1) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ projectId }) => {
      try {
        return mcpResult(await client.joinDevelopment(projectId), '已加入项目开发协作。');
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'post_update',
    {
      description: '在项目时间线发布沟通记录或追加需求',
      inputSchema: z.object({
        projectId: z.string().min(1),
        kind: z.enum(['COMMUNICATION', 'ADDITIONAL_REQUIREMENT']),
        content: z.string().min(1).max(5000),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ projectId, kind, content }) => {
      try {
        return mcpResult(await client.postUpdate(projectId, { kind, content }), '项目记录已发布。');
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'create_feedback',
    {
      description: '向项目提交缺陷、改进建议或使用咨询',
      inputSchema: z.object({
        projectId: z.string().min(1),
        type: z.enum(['BUG', 'IMPROVEMENT', 'QUESTION']),
        title: z.string().min(4).max(120),
        content: z.string().min(10).max(3000),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ projectId, type, title, content }) => {
      try {
        return mcpResult(await client.createFeedback(projectId, { type, title, content }), '反馈已提交。');
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'comment_feedback',
    {
      description: '回复一条反馈',
      inputSchema: z.object({ feedbackId: z.string().min(1), content: z.string().min(1).max(2000) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ feedbackId, content }) => {
      try {
        return mcpResult(await client.commentFeedback(feedbackId, content), '反馈回复已发布。');
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerTool(
    'sync_project',
    {
      description: '同步项目仓库的 PR 与修改记录',
      inputSchema: z.object({ projectId: z.string().min(1) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ projectId }) => {
      try {
        return mcpResult(await client.syncProject(projectId), '项目修改记录已同步。');
      } catch (error) {
        return mcpError(error);
      }
    },
  );

  server.registerResource(
    'project-context',
    new ResourceTemplate('aimanager://projects/{id}', { list: undefined }),
    { title: 'aiManager 项目上下文', description: '读取项目完整上下文', mimeType: 'application/json' },
    async (uri, variables) => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await client.getProjectContext(String(variables.id))) }],
    }),
  );

  server.registerResource(
    'feedback',
    new ResourceTemplate('aimanager://feedbacks/{id}', { list: undefined }),
    { title: 'aiManager 反馈', description: '读取反馈与评论', mimeType: 'application/json' },
    async (uri, variables) => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await client.getFeedback(String(variables.id))) }],
    }),
  );

  server.registerPrompt(
    'implement_requirement',
    {
      title: '实现需求',
      description: '从需求上下文开始实现一个 aiManager 项目',
      argsSchema: { projectId: z.string().describe('项目 ID') },
    },
    ({ projectId }) => ({
      messages: [{
        role: 'user',
        content: { type: 'text', text: `请先调用 get_project_context 获取项目 ${projectId} 的需求、沟通、反馈和 Git 信息，再给出实现计划；涉及提交或推送时必须先请求确认。` },
      }],
    }),
  );

  server.registerPrompt(
    'fix_feedback',
    {
      title: '修复反馈',
      description: '读取反馈并设计安全修复流程',
      argsSchema: { feedbackId: z.string().describe('反馈 ID') },
    },
    ({ feedbackId }) => ({
      messages: [{
        role: 'user',
        content: { type: 'text', text: `请读取反馈 ${feedbackId} 及所属项目上下文，复现并修复问题；提交、推送和创建 PR 前必须请求确认。` },
      }],
    }),
  );

  server.registerPrompt(
    'prepare_release',
    {
      title: '准备发布',
      description: '汇总验收、CI 和成果发布前检查',
      argsSchema: { projectId: z.string().describe('项目 ID') },
    },
    ({ projectId }) => ({
      messages: [{
        role: 'user',
        content: { type: 'text', text: `请检查项目 ${projectId} 的上下文、开放反馈、CI 和成果内容，列出发布前阻塞项；发布操作必须先请求确认。` },
      }],
    }),
  );
}
