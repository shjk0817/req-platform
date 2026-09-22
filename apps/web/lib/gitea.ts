'use client';

/**
 * Git 服务（Gitea）跳转与免密登录工具
 * 作用：进入 Git 服务前先向平台申请一枚免密登录 Cookie，避免员工在 Gitea 再登录一次
 * 说明：
 *   1. 平台的登录态是 JWT（存在 localStorage），Gitea 认的是这枚 Cookie，
 *      因此「登录成功」「恢复登录态」「点击任何 Git 链接」时都要确保 Cookie 已签发；
 *   2. 新窗口必须在点击事件里同步打开（否则会被浏览器拦截），因此 openGitea 先开空白窗口，
 *      拿到地址后再写入 location。
 */
import { api } from './api';
import { message } from 'antd';

/** 免密登录会话响应 */
interface GiteaSession {
  /** Git 服务根地址 */
  url: string;
  /** Git 账号是否已开通 */
  ready: boolean;
  /** 提示文案 */
  message: string;
}

/** 最近一次签发结果缓存，避免同一页面反复请求（Cookie 有效期 7 天，短时缓存足够） */
let lastIssuedAt = 0;
let lastSession: GiteaSession | null = null;
/** 同一时刻的并发请求合并为一个 */
let pending: Promise<GiteaSession | null> | null = null;
/** 缓存有效期（毫秒） */
const CACHE_TTL = 5 * 60 * 1000;

/**
 * 向平台申请（或复用）Gitea 免密登录 Cookie
 * @param force 是否忽略缓存重新签发
 * @returns 会话信息；请求失败返回 null（不抛错，避免影响主流程）
 */
export async function ensureGiteaSession(force = false): Promise<GiteaSession | null> {
  if (!force && lastSession && Date.now() - lastIssuedAt < CACHE_TTL) {
    return lastSession;
  }
  if (pending) {
    return pending;
  }
  pending = api
    .post<GiteaSession>('/gitea/session')
    .then((session) => {
      lastSession = session;
      lastIssuedAt = Date.now();
      return session;
    })
    .catch(() => null)
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** 退出登录时清掉缓存，避免下次登录复用上一位同事的会话 */
export function resetGiteaSession(): void {
  lastSession = null;
  lastIssuedAt = 0;
  pending = null;
}

/** 判断是否为站外绝对地址 */
export function isExternalUrl(target?: string | null): boolean {
  return Boolean(target && /^https?:\/\//i.test(target));
}

/**
 * 打开 Git 服务页面
 * @param target 需求仓库地址或站内路径；不传则打开 Git 服务首页
 */
export async function openGitea(target?: string | null): Promise<void> {
  // 同步打开窗口，保证不被弹窗拦截
  const win = window.open('', '_blank');
  const session = await ensureGiteaSession();
  if (!session) {
    win?.close();
    message.error('打开 Git 服务失败，请稍后重试');
    return;
  }
  if (!session.ready) {
    win?.close();
    message.warning(session.message);
    return;
  }
  const base = session.url.replace(/\/$/, '');
  const url = !target ? base : isExternalUrl(target) ? target : `${base}${target}`;
  if (win) {
    win.location.href = url;
  } else {
    window.location.href = url;
  }
}

/**
 * 签发免密 Cookie 后在当前窗口跳转到站外地址
 * 用于「从 Git 服务被弹回登录页、登录后回到原来要看的仓库页面」这类场景
 * @param url 目标地址
 */
export async function redirectToExternal(url: string): Promise<void> {
  const session = await ensureGiteaSession(true);
  if (!session) {
    window.location.href = url;
    return;
  }
  if (!session.ready) {
    message.warning(session.message);
    window.location.href = '/';
    return;
  }
  // 免密 Cookie 是按主机名共享的：如果同事是从「另一个主机名」被弹回来的
  // （例如平台用 localhost，Git 却用了 git.localhost），换回规范主机名才带得上 Cookie。
  // 但只在规范主机名与当前页面主机名一致时才改写，
  // 否则会把局域网访问（平台在服务器 IP、GITEA_ROOT_URL 写的是 localhost）错误地指向访问者本机。
  let target = url;
  try {
    const canonical = new URL(session.url);
    const parsed = new URL(url, canonical);
    if (
      parsed.hostname !== window.location.hostname &&
      canonical.hostname === window.location.hostname
    ) {
      parsed.protocol = canonical.protocol;
      parsed.host = canonical.host;
    }
    target = parsed.toString();
  } catch {
    // 地址无法解析时按原样跳转
  }
  window.location.href = target;
}
