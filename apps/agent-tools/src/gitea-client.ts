/**
 * 员工 Gitea API 客户端
 * 作用：PR、CI 与 Release 只使用员工自己的 Gitea PAT，不接触平台管理员令牌
 */
import { loadConfig } from './config.js';
import { CredentialStore } from './credentials.js';

export class GiteaApiError extends Error {
  readonly code = 'GITEA_API_FAILED';
}

export class GiteaClient {
  constructor(
    private readonly rootUrl: string,
    private readonly token: string,
  ) {}

  /** 创建 Pull Request */
  createPullRequest(owner: string, repo: string, input: { title: string; body?: string; head: string; base?: string }) {
    return this.request<unknown>(`/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`, {
      method: 'POST',
      body: { ...input, base: input.base ?? 'main' },
    });
  }

  /** 查询 Pull Request */
  listPullRequests(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'open') {
    return this.request<unknown[]>(
      `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=${state}&limit=50`,
    );
  }

  /** 查询仓库 Actions 任务 */
  listActions(owner: string, repo: string) {
    return this.request<unknown>(
      `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs?limit=20`,
    );
  }

  /** 创建 Release */
  createRelease(owner: string, repo: string, input: { tag_name: string; name: string; body?: string; draft?: boolean }) {
    return this.request<unknown>(`/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`, {
      method: 'POST',
      body: { ...input, draft: input.draft ?? true },
    });
  }

  private async request<T>(
    path: string,
    options: { method?: 'GET' | 'POST'; body?: unknown } = {},
  ): Promise<T> {
    const response = await fetch(`${this.rootUrl.replace(/\/$/, '')}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `token ${this.token}`,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { message: text };
    }
    if (!response.ok) {
      throw new GiteaApiError(
        data && typeof data === 'object' && 'message' in data
          ? String((data as { message: unknown }).message)
          : `Gitea API 请求失败（${response.status}）`,
      );
    }
    return data as T;
  }
}

/** 从系统钥匙串构造员工 Gitea 客户端 */
export async function createGiteaClient(): Promise<GiteaClient> {
  const token = process.env.AIM_GITEA_TOKEN ?? (await new CredentialStore().get('gitea-token'));
  if (!token) {
    throw new Error('未找到员工 Gitea PAT，请先执行 aim auth gitea');
  }
  return new GiteaClient(loadConfig().giteaUrl, token);
}
