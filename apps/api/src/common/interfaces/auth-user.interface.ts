/**
 * JWT 载荷类型定义
 * 作用：统一登录态中携带的字段，供策略校验与守卫读取
 */
import { Role } from '@prisma/client';

export interface JwtPayload {
  /** 用户主键 */
  sub: string;
  /** 邮箱 */
  email: string;
  /** 角色 */
  role: Role;
}

/** 请求上下文中挂载的当前登录用户信息 */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  giteaUsername: string | null;
  /** 登录来源：普通 JWT 或个人访问令牌 */
  authMethod?: 'jwt' | 'pat';
  /** 个人访问令牌主键 */
  tokenId?: string;
  /** 个人访问令牌权限范围 */
  scopes?: string[];
}
