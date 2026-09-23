/**
 * Gitea API 客户端服务
 * 作用：封装平台对自建 Gitea 的全部调用（用户开通、仓库创建、Webhook、
 *       Issue 同步、协作者授权），业务模块只需调用这里的语义化方法
 */
import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildGiteaUsername, generatePassword } from '../common/utils/naming.util';
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Gitea 返回的错误结构 */
interface GiteaErrorBody {
  message?: string;
  errors?: string[];
  url?: string;
}

/** 调用 Gitea API 失败时抛出的异常 */
export class GiteaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
    this.name = 'GiteaApiError';
  }
}

/** 请求选项 */
interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** 是否忽略 404（用于幂等判断，例如检查资源是否存在） */
  ignoreNotFound?: boolean;
}

@Injectable()
export class GiteaService {
  private readonly logger = new Logger(GiteaService.name);

  constructor(private readonly config: ConfigService) {}

  /** 容器内网基础地址 */
  private get baseUrl(): string {
    return (this.config.get<string>('gitea.internalUrl') ?? '').replace(/\/$/, '');
  }

  /** 平台使用的组织名 */
  get org(): string {
    return this.config.get<string>('gitea.org') ?? 'projects';
  }

  /** Gitea 对外根地址（用于拼接用户可点击的链接） */
  get publicRootUrl(): string {
    return (this.config.get<string>('gitea.rootUrl') ?? '').replace(/\/$/, '');
  }

  /** Gitea 是否已完成配置（未配置时相关功能降级，不阻塞平台运行） */
  get isConfigured(): boolean {
    return Boolean(this.config.get<string>('gitea.apiToken'));
  }

  // ----------------------------------------------------------------
  // 通用请求
  // ----------------------------------------------------------------

  /**
   * 发起 Gitea API 请求
   * @param path API 路径，例如 /api/v1/orgs
   * @param options 请求选项
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T | null> {
    const token = this.config.get<string>('gitea.apiToken') ?? '';
    if (!token) {
      throw new ServiceUnavailableException('Gitea 尚未完成初始化（缺少 API Token），请先执行 deploy/gitea/init.sh');
    }

    const url = new URL(`${this.baseUrl}${path}`);
    Object.entries(options.query ?? {}).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });

    let response: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: {
          Authorization: `token ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      this.logger.error(`调用 Gitea 失败: ${options.method ?? 'GET'} ${path} - ${(error as Error).message}`);
      if ((error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError') {
        throw new ServiceUnavailableException('Gitea 响应超时，请检查服务状态');
      }
      throw new ServiceUnavailableException('无法连接 Gitea 服务，请检查服务状态');
    }
    clearTimeout(timeout);

    if (response.status === 404 && options.ignoreNotFound) {
      return null;
    }

    if (!response.ok) {
      const text = await response.text();
      let message = `Gitea 接口返回 ${response.status}`;
      try {
        const parsed = JSON.parse(text) as GiteaErrorBody;
        message = parsed.message ?? parsed.errors?.join('; ') ?? message;
      } catch {
        message = text || message;
      }
      this.logger.warn(`Gitea 接口错误: ${options.method ?? 'GET'} ${path} -> ${response.status} ${message}`);
      throw new GiteaApiError(message, response.status, path);
    }

    if (response.status === 204) {
      return null;
    }
    const text = await response.text();
    return text ? (JSON.parse(text) as T) : null;
  }

  // ----------------------------------------------------------------
  // 用户
  // ----------------------------------------------------------------

  /**
   * 在 Gitea 中创建账号（平台审核通过时调用）
   * @param input 账号信息
   */
  async createUser(input: {
    username: string;
    email: string;
    password: string;
    fullName: string;
    mustChangePassword?: boolean;
  }): Promise<{ id: number; login: string }> {
    const result = await this.request<{ id: number; login: string }>('/api/v1/admin/users', {
      method: 'POST',
      body: {
        username: input.username,
        email: input.email,
        password: input.password,
        full_name: input.fullName,
        must_change_password: input.mustChangePassword ?? true,
        send_notify: false,
      },
    });
    this.logger.log(`Gitea 账号已创建: ${input.username}`);
    return result as { id: number; login: string };
  }

  /**
   * 查询 Gitea 用户是否存在
   * @param username 用户名
   */
  async getUser(username: string): Promise<{ id: number; login: string } | null> {
    return this.request<{ id: number; login: string }>(`/api/v1/users/${encodeURIComponent(username)}`, {
      ignoreNotFound: true,
    });
  }

  /**
   * 重置 Gitea 账号密码（管理员为员工重置时调用）
   * @param username 用户名
   * @param password 新密码
   */
  async resetUserPassword(username: string, password: string): Promise<void> {
    await this.request(`/api/v1/admin/users/${encodeURIComponent(username)}`, {
      method: 'PATCH',
      body: { password, must_change_password: true },
      ignoreNotFound: true,
    });
    this.logger.log(`Gitea 账号密码已重置: ${username}`);
  }

  /**
   * 启用/停用 Gitea 账号（与平台账号状态保持一致）
   * @param username 用户名
   * @param active 是否启用
   */
  async setUserActive(username: string, active: boolean): Promise<void> {
    await this.request(`/api/v1/admin/users/${encodeURIComponent(username)}`, {
      method: 'PATCH',
      body: { active },
      ignoreNotFound: true,
    });
  }

  /**
   * 为平台用户开通 Git 账号（审核通过、引导初始管理员时共用）
   * 已绑定用户名且账号确实存在时无需创建，直接返回 null
   * @param input 邮箱、姓名以及已绑定的 Git 用户名
   * @returns 新账号的用户名与初始密码；无需创建或 Gitea 未配置时返回 null
   */
  async provisionUserAccount(input: {
    email: string;
    name: string;
    existingUsername?: string | null;
  }): Promise<{ username: string; password: string } | null> {
    if (input.existingUsername) {
      const exists = await this.getUser(input.existingUsername).catch(() => null);
      if (exists) {
        return null;
      }
    }
    if (!this.isConfigured) {
      this.logger.warn('Gitea 未配置 API Token，跳过 Git 账号开通');
      return null;
    }

    // 用户名冲突时继续追加序号，允许重复执行测试或历史账号较多时顺利开通
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const username = buildGiteaUsername(input.email, input.name, attempt);
      const taken = await this.getUser(username).catch(() => null);
      if (taken) {
        continue;
      }
      const password = generatePassword(14);
      try {
        await this.createUser({
          username,
          email: input.email,
          password,
          fullName: input.name,
          mustChangePassword: true,
        });
        return { username, password };
      } catch (error) {
        this.logger.warn(`开通 Git 账号失败（第 ${attempt + 1} 次）: ${(error as Error).message}`);
      }
    }
    throw new BadRequestException('Git 账号开通失败，请检查 Gitea 服务后重试');
  }

  // ----------------------------------------------------------------
  // 仓库
  // ----------------------------------------------------------------

  /**
   * 基于模板仓库生成新项目仓库
   * @param input 仓库信息
   */
  async generateRepoFromTemplate(input: {
    templateOwner: string;
    templateRepo: string;
    owner: string;
    name: string;
    description: string;
    private?: boolean;
  }): Promise<{ full_name: string; html_url: string; clone_url: string; default_branch: string } | null> {
    const result = await this.request<{
      full_name: string;
      html_url: string;
      clone_url: string;
      default_branch: string;
    }>(`/api/v1/repos/${input.templateOwner}/${input.templateRepo}/generate`, {
      method: 'POST',
      body: {
        owner: input.owner,
        name: input.name,
        description: input.description,
        private: input.private ?? true,
        // 一并复制模板中的文件、议题标签与 PR/Issue 模板
        git_content: true,
        topics: true,
        labels: true,
        webhooks: false,
        avatar: false,
      },
      ignoreNotFound: true,
    });
    if (result) {
      this.logger.log(`Gitea 仓库已创建: ${result.full_name}`);
    }
    return result;
  }

  /**
   * 直接创建空仓库（模板不可用时兜底）
   * @param input 仓库信息
   */
  async createOrgRepo(input: {
    name: string;
    description: string;
    private?: boolean;
  }): Promise<{ full_name: string; html_url: string; clone_url: string } | null> {
    return this.request<{ full_name: string; html_url: string; clone_url: string }>(
      `/api/v1/orgs/${this.org}/repos`,
      {
        method: 'POST',
        body: {
          name: input.name,
          description: input.description,
          private: input.private ?? true,
          auto_init: true,
          default_branch: 'main',
        },
      },
    );
  }

  /**
   * 添加仓库协作者（项目成员加入时调用）
   * @param owner 仓库所属组织/用户
   * @param repo 仓库名
   * @param username Gitea 用户名
   * @param permission 权限：read / write / admin
   */
  async addCollaborator(owner: string, repo: string, username: string, permission: 'read' | 'write' | 'admin' = 'write') {
    await this.request(`/api/v1/repos/${owner}/${repo}/collaborators/${encodeURIComponent(username)}`, {
      method: 'PUT',
      body: { permission },
    });
    this.logger.log(`已添加协作者 ${username} -> ${owner}/${repo}`);
  }

  /**
   * 移除仓库协作者
   * @param owner 仓库所属组织/用户
   * @param repo 仓库名
   * @param username Gitea 用户名
   */
  async removeCollaborator(owner: string, repo: string, username: string) {
    await this.request(`/api/v1/repos/${owner}/${repo}/collaborators/${encodeURIComponent(username)}`, {
      method: 'DELETE',
      ignoreNotFound: true,
    });
  }

  /**
   * 为仓库配置 Webhook，事件回写到本平台
   * 说明：Gitea 的密钥必须放在 config.secret 中，否则不会下发 X-Gitea-Signature
   * @param owner 仓库所属组织/用户
   * @param repo 仓库名
   */
  async ensureWebhook(owner: string, repo: string): Promise<void> {
    const secret = this.config.get<string>('gitea.webhookSecret') ?? '';
    const selfUrl = (this.config.get<string>('selfInternalUrl') ?? '').replace(/\/$/, '');
    const target = `${selfUrl}/api/webhooks/gitea`;

    const hookConfig = {
      type: 'gitea',
      active: true,
      branch_filter: '*',
      config: { url: target, content_type: 'json', http_method: 'post', secret },
      // 说明：Gitea 1.22 可订阅的事件有限（不含 status / workflow_run），
      //      因此流水线状态通过工作流内的回调接口上报（见 configureCiReporting）
      events: [
        'push',
        'create',
        'delete',
        'issues',
        'issue_comment',
        'pull_request',
        'pull_request_review_approved',
        'pull_request_review_rejected',
        'pull_request_review_comment',
        'release',
      ],
    };

    // 先检查是否已存在指向本平台的 Webhook，保证幂等（并修复历史配置）
    const existing = await this.request<Array<{ id: number; config: { url?: string } }>>(
      `/api/v1/repos/${owner}/${repo}/hooks`,
      { ignoreNotFound: true },
    );
    const matched = existing?.find((hook) => hook.config?.url === target);
    if (matched) {
      await this.request(`/api/v1/repos/${owner}/${repo}/hooks/${matched.id}`, {
        method: 'PATCH',
        body: hookConfig,
        ignoreNotFound: true,
      });
      this.logger.debug(`Webhook 已存在并刷新配置: ${owner}/${repo}`);
      return;
    }

    await this.request(`/api/v1/repos/${owner}/${repo}/hooks`, {
      method: 'POST',
      body: hookConfig,
      ignoreNotFound: true,
    });
    this.logger.log(`Webhook 已配置: ${owner}/${repo} -> ${target}`);
  }

  // ----------------------------------------------------------------
  // Issue（反馈）
  // ----------------------------------------------------------------

  /**
   * 把流水线回调地址与令牌写入仓库的 workflow 文件
   * 说明：Gitea 1.22 的 Webhook 不支持订阅流水线事件，因此由工作流结束时主动回调平台
   * @param owner 仓库所属组织/用户
   * @param repo 仓库名
   * @param branch 写入的目标分支
   */
  async configureCiReporting(owner: string, repo: string, branch = 'main'): Promise<void> {
    const token = this.config.get<string>('ci.callbackToken') ?? '';
    const selfUrl = (this.config.get<string>('selfInternalUrl') ?? '').replace(/\/$/, '');
    if (!token || !selfUrl) {
      return;
    }
    const callbackUrl = `${selfUrl}/api/webhooks/ci`;

    for (const file of ['.gitea/workflows/ci.yml', '.gitea/workflows/release.yml']) {
      try {
        const existing = await this.request<{ content: string; sha: string }>(
          `/api/v1/repos/${owner}/${repo}/contents/${file}`,
          { query: { ref: branch }, ignoreNotFound: true },
        );
        if (!existing?.content) {
          continue;
        }
        const decoded = Buffer.from(existing.content, 'base64').toString('utf8');
        if (!decoded.includes('__CI_CALLBACK_URL__')) {
          continue;
        }
        const updated = decoded
          .split('__CI_CALLBACK_URL__')
          .join(callbackUrl)
          .split('__CI_CALLBACK_TOKEN__')
          .join(token);

        await this.request(`/api/v1/repos/${owner}/${repo}/contents/${file}`, {
          method: 'PUT',
          body: {
            content: Buffer.from(updated, 'utf8').toString('base64'),
            sha: existing.sha,
            branch,
            message: 'chore(ci): 配置流水线状态回调',
          },
        });
        this.logger.log(`流水线回调已配置: ${owner}/${repo} ${file}`);
      } catch (error) {
        this.logger.warn(`配置流水线回调失败: ${owner}/${repo} ${file} - ${(error as Error).message}`);
      }
    }
  }

  /**
   * 创建 Issue 相关：把标签名称转换为 Gitea 的标签 ID（不存在时自动创建）
   * 说明：Gitea 创建 Issue 的 labels 字段只接受 int64 数组
   * @param owner 仓库所属组织/用户
   * @param repo 仓库名
   * @param names 标签名称列表
   */
  private async resolveLabelIds(owner: string, repo: string, names?: string[]): Promise<number[] | undefined> {
    if (!names || names.length === 0) {
      return undefined;
    }

    const existing =
      (await this.request<Array<{ id: number; name: string }>>(`/api/v1/repos/${owner}/${repo}/labels`, {
        query: { limit: 100 },
        ignoreNotFound: true,
      })) ?? [];

    const ids: number[] = [];
    for (const name of names) {
      let matched = existing.find((label) => label.name.toLowerCase() === name.toLowerCase());
      if (!matched) {
        matched =
          (await this.request<{ id: number; name: string }>(`/api/v1/repos/${owner}/${repo}/labels`, {
            method: 'POST',
            body: { name, color: '#1f6feb' },
            ignoreNotFound: true,
          })) ?? undefined;
        if (matched) {
          existing.push(matched);
        }
      }
      if (matched) {
        ids.push(matched.id);
      }
    }
    return ids.length > 0 ? ids : undefined;
  }

  /**
   * 在项目仓库创建 Issue（平台反馈同步）
   * @param owner 仓库所属组织/用户
   * @param repo 仓库名
   * @param input Issue 内容
   */
  async createIssue(
    owner: string,
    repo: string,
    input: { title: string; body: string; labels?: string[]; assignees?: string[] },
  ): Promise<{ number: number; html_url: string } | null> {
    const labelIds = await this.resolveLabelIds(owner, repo, input.labels);
    return this.request<{ number: number; html_url: string }>(`/api/v1/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      body: {
        title: input.title,
        body: input.body,
        labels: labelIds,
        assignees: input.assignees,
      },
      ignoreNotFound: true,
    });
  }

  /**
   * 在 Issue 下追加评论
   * @param owner 仓库所属组织/用户
   * @param repo 仓库名
   * @param index Issue 编号
   * @param body 评论内容
   */
  async createIssueComment(owner: string, repo: string, index: number, body: string): Promise<void> {
    await this.request(`/api/v1/repos/${owner}/${repo}/issues/${index}/comments`, {
      method: 'POST',
      body: { body },
      ignoreNotFound: true,
    });
  }

  /**
   * 关闭 Issue 并追加说明
   * @param owner 仓库所属组织/用户
   * @param repo 仓库名
   * @param index Issue 编号
   * @param comment 关闭说明
   */
  async closeIssue(owner: string, repo: string, index: number, comment?: string): Promise<void> {
    if (comment) {
      await this.createIssueComment(owner, repo, index, comment);
    }
    await this.request(`/api/v1/repos/${owner}/${repo}/issues/${index}`, {
      method: 'PATCH',
      body: { state: 'closed' },
      ignoreNotFound: true,
    });
  }

  // ----------------------------------------------------------------
  // 查询
  // ----------------------------------------------------------------

  /**
   * 读取仓库中的单个文本文件
   * 作用：成果页只读取 README 与教程，不把 Gitea 仓库内容复制到平台数据库
   * @param owner 仓库所属组织
   * @param repo 仓库名
   * @param path 文件路径
   * @param ref 分支或标签
   */
  async getRepositoryFile(
    owner: string,
    repo: string,
    path: string,
    ref = 'main',
  ): Promise<{ path: string; content: string; htmlUrl?: string } | null> {
    const file = await this.request<{
      type?: string;
      path?: string;
      content?: string;
      html_url?: string;
    }>(`/api/v1/repos/${owner}/${repo}/contents/${path}`, {
      query: { ref },
      ignoreNotFound: true,
    });
    if (!file?.content || file.type === 'dir') {
      return null;
    }
    return {
      path: file.path ?? path,
      content: Buffer.from(file.content.replace(/\s/g, ''), 'base64').toString('utf8'),
      htmlUrl: file.html_url,
    };
  }

  /**
   * 读取仓库 README
   * @param owner 仓库所属组织
   * @param repo 仓库名
   */
  async getRepositoryReadme(owner: string, repo: string) {
    return this.getRepositoryFile(owner, repo, 'README.md');
  }

  /**
   * 按约定路径查找使用教程
   * 作用：兼容新模板与旧仓库，避免要求开发同事立刻迁移文件名
   * @param owner 仓库所属组织
   * @param repo 仓库名
   */
  async getRepositoryTutorial(owner: string, repo: string) {
    for (const path of ['docs/USAGE.md', 'docs/README.md', 'USAGE.md']) {
      const file = await this.getRepositoryFile(owner, repo, path);
      if (file) {
        return file;
      }
    }
    return null;
  }

  /**
   * 查询 Release 及其下载附件
   * @param owner 仓库所属组织
   * @param repo 仓库名
   */
  async listReleaseDownloads(owner: string, repo: string) {
    const releases =
      (await this.request<
        Array<{
          id: number;
          tag_name: string;
          name?: string;
          html_url: string;
          published_at?: string | null;
          assets?: Array<{ id: number; name: string; size: number; browser_download_url: string }>;
        }>
      >(`/api/v1/repos/${owner}/${repo}/releases`, {
        query: { limit: 20 },
        ignoreNotFound: true,
      })) ?? [];

    return releases.map((release) => ({
      id: release.id,
      tag: release.tag_name,
      name: release.name || release.tag_name,
      htmlUrl: release.html_url,
      publishedAt: release.published_at ?? null,
      assets: (release.assets ?? []).map((asset) => ({
        id: asset.id,
        name: asset.name,
        size: asset.size,
        downloadUrl: asset.browser_download_url,
      })),
    }));
  }

  /**
   * 查询仓库的 Pull Request 列表（Webhook 之外的兜底同步用）
   * @param owner 仓库所属组织/用户
   * @param repo 仓库名
   */
  async listPullRequests(owner: string, repo: string) {
    return this.request<
      Array<{
        number: number;
        title: string;
        state: string;
        merged: boolean;
        mergeable: boolean;
        html_url: string;
        user: { login: string };
        head: { ref: string };
        base: { ref: string };
        merged_at: string | null;
        closed_at: string | null;
        created_at: string;
      }>
    >(`/api/v1/repos/${owner}/${repo}/pulls`, {
      query: { state: 'all', limit: 50, sort: 'recentupdate' },
      ignoreNotFound: true,
    });
  }

  // ----------------------------------------------------------------
  // Webhook 签名校验
  // ----------------------------------------------------------------

  /**
   * 校验 Gitea Webhook 的 HMAC-SHA256 签名
   * @param rawBody 原始请求体
   * @param signature 请求头中的签名值
   */
  verifyWebhookSignature(rawBody: Buffer | undefined, signature?: string): boolean {
    const secret = this.config.get<string>('gitea.webhookSecret') ?? '';
    if (!secret) {
      // 未配置密钥时跳过校验，便于本地联调
      return true;
    }
    if (!rawBody || !signature) {
      return false;
    }
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature.replace(/^sha256=/, ''), 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
