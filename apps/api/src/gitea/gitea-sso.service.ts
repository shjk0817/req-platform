/**
 * Gitea 免密登录（SSO）服务
 * 作用：让员工在平台上点一下就能进入已登录的 Git 服务，无需再记一套 Gitea 密码
 * 原理：
 *   1. 平台登录后调用 POST /api/gitea/session，后端在浏览器写入一枚 httpOnly 的 SSO Cookie；
 *   2. Caddy 收到 Git 站点的页面请求时，先通过 forward_auth 回调 /api/auth/gitea-verify；
 *   3. 该接口用 Cookie 解析出平台用户，并把 Gitea 用户名放进响应头 X-Gitea-User；
 *   4. Gitea 开启「反向代理认证」后，会依据该请求头自动完成登录。
 * 注意：Cookie 按域名（不含端口）共享，因此平台与 Gitea 使用同一台主机（不同端口）时 SSO 才生效。
 */
import { PrismaService } from '../prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';

/** SSO Cookie 名称 */
export const GITEA_SSO_COOKIE = 'aimanager_gitea_sso';

/** Cookie 载荷：用独立的 scope 标记，避免与登录令牌混用 */
interface SsoCookiePayload {
  /** 用户主键 */
  sub: string;
  /** 固定为 gitea-sso */
  scope: string;
}

/** Gitea 侧可用的账号信息 */
export interface GiteaSsoAccount {
  /** Gitea 用户名（反向代理认证的凭据） */
  username: string;
  /** 用于自动登记的邮箱 */
  email: string;
}

@Injectable()
export class GiteaSsoService {
  private readonly logger = new Logger(GiteaSsoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  /** Gitea 对外根地址（用于跳转） */
  get giteaRootUrl(): string {
    return this.config.get<string>('gitea.rootUrl') ?? 'http://git.localhost/';
  }

  /** 平台对外地址（用于失效时跳回登录页） */
  get appUrl(): string {
    return this.config.get<string>('appUrl') ?? 'http://app.localhost';
  }

  /** 签发 SSO Cookie 值 */
  issueCookie(userId: string): string {
    const payload: SsoCookiePayload = { sub: userId, scope: 'gitea-sso' };
    return this.jwt.sign(payload, { expiresIn: '7d' });
  }

  /**
   * 校验平台登录令牌（Bearer Token），返回 Gitea 账号信息
   * @param token 平台 JWT
   */
  async resolveByToken(token: string): Promise<GiteaSsoAccount | null> {
    try {
      const payload = this.jwt.verify<{ sub: string }>(token);
      return await this.findAccount(payload.sub);
    } catch {
      return null;
    }
  }

  /**
   * 校验 SSO Cookie，返回 Gitea 账号信息
   * @param cookieValue Cookie 中的 JWT
   */
  async resolveByCookie(cookieValue: string): Promise<GiteaSsoAccount | null> {
    try {
      const payload = this.jwt.verify<SsoCookiePayload>(cookieValue);
      if (payload.scope !== 'gitea-sso') {
        return null;
      }
      return await this.findAccount(payload.sub);
    } catch {
      return null;
    }
  }

  /** 按用户主键取出可用于 Gitea 的账号信息 */
  private async findAccount(userId: string): Promise<GiteaSsoAccount | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, giteaUsername: true, status: true },
    });
    if (!user || user.status !== UserStatus.ACTIVE || !user.giteaUsername) {
      this.logger.warn(`用户 ${userId} 不具备 Gitea 账号，跳过免密登录`);
      return null;
    }
    return { username: user.giteaUsername, email: user.email };
  }
}
