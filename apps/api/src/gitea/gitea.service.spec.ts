/**
 * Gitea 客户端单测
 * 作用：验证请求超时、连接失败与错误映射等边界行为
 */
import { GiteaApiError, GiteaService } from './gitea.service';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** 测试用的配置项 */
const CONFIG: Record<string, unknown> = {
  'gitea.apiToken': 'test-token',
  'gitea.internalUrl': 'http://gitea:3000/',
  'gitea.org': 'projects',
  'gitea.rootUrl': 'http://git.example.com',
};

/** 构造注入了固定配置的 GiteaService */
function createService(overrides: Record<string, unknown> = {}): GiteaService {
  const values = { ...CONFIG, ...overrides };
  const config = { get: (key: string) => values[key] } as unknown as ConfigService;
  return new GiteaService(config);
}

/** 构造一个成功响应 */
function okResponse(body: unknown, status = 200): Response {
  return {
    ok: true,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

/** 构造一个失败响应 */
function errorResponse(status: number, body = ''): Response {
  return {
    ok: false,
    status,
    text: async () => body,
  } as unknown as Response;
}

describe('GiteaService.request', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('正常情况下返回解析后的响应体', async () => {
    global.fetch = jest.fn().mockResolvedValue(okResponse({ version: '1.22.0' })) as unknown as typeof fetch;

    await expect(createService().request('/api/v1/version')).resolves.toEqual({ version: '1.22.0' });
  });

  it('204 响应返回 null', async () => {
    global.fetch = jest.fn().mockResolvedValue(okResponse(undefined, 204)) as unknown as typeof fetch;

    await expect(createService().request('/api/v1/x', { method: 'DELETE' })).resolves.toBeNull();
  });

  it('请求携带 AbortSignal，避免 Gitea 无响应时长时间挂起', async () => {
    const fetchMock = jest.fn().mockResolvedValue(okResponse({}));
    global.fetch = fetchMock as unknown as typeof fetch;

    await createService().request('/api/v1/version');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('超时抛出 503，并给出区别于连接失败的提示', async () => {
    const timeoutError = new Error('The operation was aborted due to timeout');
    timeoutError.name = 'TimeoutError';
    global.fetch = jest.fn().mockRejectedValue(timeoutError) as unknown as typeof fetch;

    const promise = createService().request('/api/v1/version');

    await expect(promise).rejects.toThrow(ServiceUnavailableException);
    await expect(promise).rejects.toThrow(/响应超时/);
  });

  it('连接失败抛出 503 并提示检查服务状态', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED')) as unknown as typeof fetch;

    await expect(createService().request('/api/v1/version')).rejects.toThrow(/无法连接 Gitea 服务/);
  });

  it('ignoreNotFound 时 404 返回 null', async () => {
    global.fetch = jest.fn().mockResolvedValue(errorResponse(404, 'not found')) as unknown as typeof fetch;

    await expect(createService().request('/api/v1/x', { ignoreNotFound: true })).resolves.toBeNull();
  });

  it('非 2xx 抛出 GiteaApiError，并带上 Gitea 返回的 message', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(errorResponse(422, JSON.stringify({ message: '仓库名已存在' }))) as unknown as typeof fetch;

    const promise = createService().request('/api/v1/x', { method: 'POST', body: {} });

    await expect(promise).rejects.toBeInstanceOf(GiteaApiError);
    await expect(promise).rejects.toThrow('仓库名已存在');
  });

  it('缺少 API Token 时直接抛出 503，不发起请求', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(createService({ 'gitea.apiToken': '' }).request('/api/v1/version')).rejects.toThrow(
      /尚未完成初始化/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GiteaService 成果读取', () => {
  it('读取并解码仓库 README', async () => {
    const service = createService();
    jest.spyOn(service, 'request').mockResolvedValue({
      type: 'file',
      content: Buffer.from('# 月度报表工具', 'utf8').toString('base64'),
      html_url: 'http://git.example.com/projects/monthly-report/src/branch/main/README.md',
    });

    await expect(service.getRepositoryReadme('projects', 'monthly-report')).resolves.toEqual({
      path: 'README.md',
      content: '# 月度报表工具',
      htmlUrl: 'http://git.example.com/projects/monthly-report/src/branch/main/README.md',
    });
  });

  it('按约定路径读取使用教程，缺失时返回 null', async () => {
    const service = createService();
    const request = jest
      .spyOn(service, 'request')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        type: 'file',
        content: Buffer.from('## 使用步骤', 'utf8').toString('base64'),
        html_url: 'http://git.example.com/docs/README.md',
      });

    await expect(service.getRepositoryTutorial('projects', 'monthly-report')).resolves.toEqual({
      path: 'docs/README.md',
      content: '## 使用步骤',
      htmlUrl: 'http://git.example.com/docs/README.md',
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('把 Release 资产整理成成果下载数据', async () => {
    const service = createService();
    jest.spyOn(service, 'request').mockResolvedValue([
      {
        id: 1,
        tag_name: 'v1.0.0',
        name: '首个版本',
        html_url: 'http://git.example.com/releases/v1.0.0',
        published_at: '2026-09-22T00:00:00.000Z',
        assets: [{ id: 2, name: 'tool.zip', size: 12, browser_download_url: 'http://git.example.com/tool.zip' }],
      },
    ]);

    await expect(service.listReleaseDownloads('projects', 'monthly-report')).resolves.toEqual([
      {
        id: 1,
        tag: 'v1.0.0',
        name: '首个版本',
        htmlUrl: 'http://git.example.com/releases/v1.0.0',
        publishedAt: '2026-09-22T00:00:00.000Z',
        assets: [{ id: 2, name: 'tool.zip', size: 12, downloadUrl: 'http://git.example.com/tool.zip' }],
      },
    ]);
  });
});

describe('GiteaService 用户开通', () => {
  it('用户名连续冲突时继续使用序号，避免重复 E2E 运行失败', async () => {
    const service = createService();
    const getUser = jest
      .spyOn(service, 'getUser')
      .mockResolvedValueOnce({ id: 1, login: 'zhanglei' })
      .mockResolvedValueOnce({ id: 2, login: 'zhanglei2' })
      .mockResolvedValueOnce({ id: 3, login: 'zhanglei3' })
      .mockResolvedValueOnce(null);
    const createUser = jest.spyOn(service, 'createUser').mockResolvedValue({ id: 4, login: 'zhanglei4' });

    await expect(
      service.provisionUserAccount({
        email: 'zhang.lei@example.com',
        name: '张磊',
      }),
    ).resolves.toMatchObject({ username: 'zhanglei4' });

    expect(getUser).toHaveBeenCalledTimes(4);
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'zhanglei4',
        email: 'zhang.lei@example.com',
        fullName: '张磊',
      }),
    );
  });
});
