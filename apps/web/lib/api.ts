/**
 * 后端 API 客户端
 * 作用：统一处理请求地址、登录态注入与错误提示
 */
import type { Attachment } from './types';

/** API 基础路径：默认走同域 /api，由 Caddy 反向代理到后端 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

/** 本地存储中保存 Token 的键名 */
const TOKEN_KEY = 'aimanager_token';

/** 读取登录令牌 */
export function getToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage.getItem(TOKEN_KEY);
}

/** 写入登录令牌 */
export function setToken(token: string): void {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(TOKEN_KEY, token);
  }
}

/** 清除登录令牌 */
export function clearToken(): void {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(TOKEN_KEY);
  }
}

/** 接口错误 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 请求选项 */
interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** 查询参数，undefined 的字段会被忽略 */
  query?: Record<string, string | number | boolean | undefined | null>;
}

/**
 * 发起后端请求
 * @param path 接口路径，例如 /projects
 * @param options 请求选项
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(`${API_BASE}${path}`, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  Object.entries(options.query ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('无法连接平台服务，请检查网络或联系管理员', 0);
  }

  if (response.status === 401) {
    // 登录态失效：清理本地令牌并跳转登录页
    clearToken();
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    throw new ApiError('登录状态已失效，请重新登录', 401);
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      (data && typeof data === 'object' && 'message' in data
        ? String((data as { message: unknown }).message)
        : '') || `请求失败（${response.status}）`;
    throw new ApiError(message, response.status);
  }

  return data as T;
}

/** 便捷方法集合 */
export const api = {
  get: <T>(path: string, query?: RequestOptions['query']) => request<T>(path, { query }),
  post: <T>(path: string, body?: unknown, query?: RequestOptions['query']) =>
    request<T>(path, { method: 'POST', body, query }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/**
 * 上传图片或附件（multipart/form-data）
 * 说明：不能复用 request()，因为文件必须走 FormData，且不能手工设置 Content-Type
 * @param file 浏览器 File 对象
 */
export async function uploadFile<T = Attachment>(file: File): Promise<T> {
  const url = `${API_BASE}/uploads`;
  const form = new FormData();
  // 后端字段名固定为 file
  form.append('file', file);

  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', headers, body: form });
  } catch {
    throw new ApiError('文件上传失败，请检查网络后重试', 0);
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message =
      (data && typeof data === 'object' && 'message' in data
        ? String((data as { message: unknown }).message)
        : '') || `上传失败（${response.status}）`;
    throw new ApiError(message, response.status);
  }
  return data as T;
}

/** 上传自定义头像并返回更新后的用户资料 */
export async function uploadAvatar<T = { avatarUrl?: string | null }>(file: File): Promise<T> {
  const url = `${API_BASE}/users/profile/avatar`;
  const form = new FormData();
  form.append('file', file);

  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', headers, body: form });
  } catch {
    throw new ApiError('头像上传失败，请检查网络后重试', 0);
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message =
      (data && typeof data === 'object' && 'message' in data
        ? String((data as { message: unknown }).message)
        : '') || `头像上传失败（${response.status}）`;
    throw new ApiError(message, response.status);
  }
  return data as T;
}
