/**
 * Gitea 免密登录（SSO）控制器
 * 作用：
 *   1. POST /api/gitea/session —— 平台内调用，写入 SSO Cookie 并返回 Git 服务地址；
 *   2. GET  /api/auth/gitea-verify —— 供 Caddy 的 forward_auth 调用，
 *      校验 Cookie 并通过响应头把 Gitea 用户名透传给 Gitea（反向代理认证）。
 */
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { GITEA_SSO_COOKIE, GiteaSsoService } from './gitea-sso.service';
import { Controller, Get, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

/** 从 Cookie 请求头里取指定名称的值（避免额外引入 cookie-parser） */
function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) {
    return null;
  }
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) {
      continue;
    }
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return null;
}

/** 平台侧：进入 Git 服务的入口 */
@ApiTags('Gitea 集成')
@Controller('gitea')
export class GiteaSsoController {
  constructor(private readonly sso: GiteaSsoService) {}

  /** 写入 SSO Cookie，前端拿到地址后直接打开即可免密进入 Git 服务 */
  @Post('session')
  @ApiBearerAuth()
  @ApiOperation({ summary: '写入 Gitea 免密登录 Cookie，返回 Git 服务地址' })
  createSession(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): { url: string; ready: boolean; message: string } {
    const ready = Boolean(user.giteaUsername);
    if (ready) {
      res.cookie(GITEA_SSO_COOKIE, this.sso.issueCookie(user.id), {
        httpOnly: true,
        // 同站跳转（同一主机的不同端口）需要携带 Cookie，因此不能是 Strict
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
    }
    return {
      url: this.sso.giteaRootUrl,
      ready,
      message: ready
        ? '正在打开 Git 服务，平台会自动完成登录'
        : '你的 Git 账号尚未开通，请联系管理员在「用户审核」中处理',
    };
  }
}

/** Gitea 侧：Caddy forward_auth 校验端点 */
@ApiTags('Gitea 集成')
@Controller('auth')
export class GiteaAuthBridgeController {
  constructor(private readonly sso: GiteaSsoService) {}

  /**
   * 校验浏览器 Cookie 中的平台登录态
   * 校验通过：返回 200 + X-Gitea-User / X-Gitea-Email 响应头（由 Caddy copy_headers 透传）
   * 校验失败：返回 302 跳转到平台登录页，用户登录后再次访问即可
   */
  @Public()
  @Get('gitea-verify')
  @ApiOperation({ summary: 'Gitea 反向代理认证校验（供 Caddy forward_auth 调用）' })
  async verify(@Req() req: Request, @Res() res: Response): Promise<void> {
    const cookieValue = readCookie(req, GITEA_SSO_COOKIE);
    const account = cookieValue ? await this.sso.resolveByCookie(cookieValue) : null;

    if (!account) {
      // 未登录或免密 Cookie 缺失：引导回平台登录，并带上原始访问地址，
      // 登录后自动回到刚才要看的 Git 页面（否则同事会落在工作台，以为「点了还要登录」）
      const loginUrl = `${this.sso.appUrl.replace(/\/$/, '')}/login?redirect=${encodeURIComponent(
        this.buildOriginalUrl(req),
      )}`;
      res.redirect(HttpStatus.FOUND, loginUrl);
      return;
    }

    res.setHeader('X-Gitea-User', account.username);
    res.setHeader('X-Gitea-Email', account.email);
    res.status(HttpStatus.OK).send('ok');
  }

  /**
   * 还原被 forward_auth 拦截前的原始访问地址
   * Caddy 的 forward_auth 会把原始请求的 Proto / Host / Uri 放进 X-Forwarded-* 请求头
   * @param req 当前请求
   */
  private buildOriginalUrl(req: Request): string {
    const proto =
      (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || 'http';
    const originalHost =
      (req.headers['x-forwarded-host'] as string | undefined) ??
      (req.headers.host as string | undefined) ??
      '';
    const originalUri = (req.headers['x-forwarded-uri'] as string | undefined) ?? '/';
    if (!originalHost) {
      return this.sso.giteaRootUrl;
    }
    // X-Forwarded-Uri 已包含查询串，直接拼接即可；必须是带协议的绝对地址，
    // 前端据此判断「站外地址」并先签发免密 Cookie 再跳转
    const suffix = originalUri.startsWith('/') ? originalUri : `/${originalUri}`;
    return `${proto}://${originalHost}${suffix}`;
  }
}
