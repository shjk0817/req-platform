/**
 * aiManager Agent API 客户端
 * 作用：统一 Bearer PAT、request id、错误码和平台机器接口调用
 */
import { randomUUID } from 'node:crypto';
import type {
  AgentClientOptions,
  AgentError,
  CreateFeedbackInput,
  CreateProjectInput,
  CreateUpdateInput,
  ProjectContext,
  ProjectGitInfo,
} from './types.js';

export class AgentApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = 'AGENT_REQUEST_FAILED',
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'AgentApiError';
  }
}

export class AgentClient {
  private readonly apiUrl: string;
  private readonly token: string;

  constructor(options: AgentClientOptions) {
    this.apiUrl = options.apiUrl.replace(/\/$/, '');
    this.token = options.token;
  }

  /** 汇总当前用户工作 */
  getMyWork(query: Record<string, string | number | undefined> = {}) {
    return this.request<unknown>('/agent/me/work', { query });
  }

  /** 查询项目 */
  listProjects(query: Record<string, string | number | boolean | undefined> = {}) {
    return this.request<unknown>('/agent/projects', { query });
  }

  /** 查询项目完整上下文 */
  getProjectContext(projectId: string) {
    return this.request<ProjectContext>(`/agent/projects/${encodeURIComponent(projectId)}/context`);
  }

  /** 查询项目 Git 元数据 */
  getProjectGit(projectId: string) {
    return this.request<ProjectGitInfo>(`/agent/projects/${encodeURIComponent(projectId)}/git`);
  }

  /** 查询成果 */
  getDeliverables(projectId: string) {
    return this.request<unknown>(`/agent/projects/${encodeURIComponent(projectId)}/deliverables`);
  }

  /** 查询反馈 */
  listFeedbacks(query: Record<string, string | number | undefined> = {}) {
    return this.request<unknown>('/agent/feedbacks', { query });
  }

  /** 查询反馈详情 */
  getFeedback(feedbackId: string) {
    return this.request<unknown>(`/agent/feedbacks/${encodeURIComponent(feedbackId)}`);
  }

  /** 查询通知 */
  getNotifications(query: Record<string, string | number | undefined> = {}) {
    return this.request<unknown>('/agent/notifications', { query });
  }

  /** 发布需求 */
  createProject(input: CreateProjectInput) {
    return this.request<unknown>('/agent/projects', { method: 'POST', body: input });
  }

  /** 认领需求 */
  claimProject(projectId: string, input: Record<string, unknown> = {}) {
    return this.request<unknown>(`/agent/projects/${encodeURIComponent(projectId)}/claim`, {
      method: 'POST',
      body: input,
    });
  }

  /** 加入开发 */
  joinDevelopment(projectId: string) {
    return this.request<unknown>(`/agent/projects/${encodeURIComponent(projectId)}/join`, { method: 'POST' });
  }

  /** 发布沟通或追加需求 */
  postUpdate(projectId: string, input: CreateUpdateInput) {
    return this.request<unknown>(`/agent/projects/${encodeURIComponent(projectId)}/updates`, {
      method: 'POST',
      body: input,
    });
  }

  /** 提交反馈 */
  createFeedback(projectId: string, input: CreateFeedbackInput) {
    return this.request<unknown>(`/agent/projects/${encodeURIComponent(projectId)}/feedbacks`, {
      method: 'POST',
      body: input,
    });
  }

  /** 回复反馈 */
  commentFeedback(feedbackId: string, content: string) {
    return this.request<unknown>(`/agent/feedbacks/${encodeURIComponent(feedbackId)}/comments`, {
      method: 'POST',
      body: { content },
    });
  }

  /** 同步项目 PR 记录 */
  syncProject(projectId: string) {
    return this.request<unknown>(`/agent/projects/${encodeURIComponent(projectId)}/sync`, { method: 'POST' });
  }

  private async request<T>(
    path: string,
    options: {
      method?: 'GET' | 'POST';
      body?: unknown;
      query?: Record<string, string | number | boolean | undefined>;
    } = {},
  ): Promise<T> {
    const url = new URL(`${this.apiUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    const requestId = randomUUID();
    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
          'x-request-id': requestId,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      throw new AgentApiError(`无法连接 aiManager API：${(error as Error).message}`, 0, 'NETWORK_ERROR', requestId);
    }

    const text = await response.text();
    const data = text ? this.parseJson(text) : null;
    if (!response.ok) {
      const detail = (data && typeof data === 'object' ? data : {}) as AgentError;
      throw new AgentApiError(
        detail.message ?? `Agent API 请求失败（${response.status}）`,
        response.status,
        detail.code ?? 'AGENT_REQUEST_FAILED',
        detail.requestId ?? response.headers.get('x-request-id') ?? requestId,
      );
    }
    return data as T;
  }

  private parseJson(text: string): unknown {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { message: text };
    }
  }
}
