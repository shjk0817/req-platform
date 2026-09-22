'use client';

/**
 * 登录态上下文
 * 作用：全局维护当前用户信息，提供登录、注册、登出方法
 * 说明：登录态本身是 JWT（localStorage）。由于 Git 服务（Gitea）认的是平台的免密 Cookie，
 *      这里在「恢复登录态」和「登录成功」后顺手签发一次，任意入口进入 Git 服务都能免密
 */
import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, clearToken, getToken, setToken } from './api';
import { ensureGiteaSession, resetGiteaSession } from './gitea';
import type { User } from './types';

interface AuthContextValue {
  /** 当前登录用户，未登录为 null */
  user: User | null;
  /** 登录态是否已初始化完成 */
  ready: boolean;
  /** 是否为管理员 */
  isAdmin: boolean;
  /** 登录 */
  login: (email: string, password: string) => Promise<User>;
  /** 注册（提交后需管理员审核） */
  register: (payload: RegisterPayload) => Promise<{ message: string }>;
  /** 退出登录 */
  logout: () => void;
  /** 刷新当前用户信息 */
  refresh: () => Promise<void>;
}

/** 注册入参 */
export interface RegisterPayload {
  email: string;
  name: string;
  password: string;
  department?: string;
  skills?: string[];
}

/** 开发账号选择器开关，由 Next.js 构建时环境变量注入 */
export const DEV_USER_PICKER_ENABLED = process.env.NEXT_PUBLIC_DEV_USER_PICKER === 'true';

/** 开发账号选择器展示的数据 */
export interface DevPickerUser {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'EMPLOYEE';
  password: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** 登录态提供者，需包裹在应用最外层 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  /** 拉取当前用户信息 */
  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      return;
    }
    try {
      const profile = await api.get<User>('/auth/me');
      setUser(profile);
      // 顺手签发 Git 免密 Cookie：这样从任何入口（消息通知、反馈里的 Issue 链接、
      // 直接打开 Git 地址）进入 Git 服务都是已登录状态，不需要先点一次「代码仓库」
      if (profile.giteaUsername) {
        void ensureGiteaSession();
      }
    } catch {
      setUser(null);
    }
  }, []);

  // 首次加载时恢复登录态
  useEffect(() => {
    void (async () => {
      await refresh();
      setReady(true);
    })();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.post<{ token: string; user: User }>('/auth/login', { email, password });
    setToken(result.token);
    setUser(result.user);
    // 登录后立刻签发 Git 免密 Cookie，避免同事第一次进 Git 服务还要再登录一次
    resetGiteaSession();
    if (result.user.giteaUsername) {
      await ensureGiteaSession(true);
    }
    return result.user;
  }, []);

  const register = useCallback(async (payload: RegisterPayload) => {
    return api.post<{ message: string }>('/auth/register', payload);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    // 清掉免密会话缓存，避免下一位登录的同事复用上一位的 Git 会话
    resetGiteaSession();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, ready, isAdmin: user?.role === 'ADMIN', login, register, logout, refresh }),
    [user, ready, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** 读取登录态上下文 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth 必须在 AuthProvider 内部使用');
  }
  return ctx;
}
