/**
 * 全局 JWT 认证守卫
 * 作用：默认所有接口都需要登录，被 @Public 标记的接口放行
 */
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { IntegrationService } from '../../integrations/integration.service';
import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly integrationService: IntegrationService,
  ) {
    super();
  }

  /** 判断接口是否允许匿名访问，并优先解析个人访问令牌 */
  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      user?: unknown;
    }>();
    const authorization = request.headers.authorization;
    if (authorization?.startsWith('Bearer aim_')) {
      return this.authenticateIntegrationToken(request, authorization.slice('Bearer '.length));
    }
    return super.canActivate(context);
  }

  /** 解析 PAT 并挂载统一 AuthUser */
  private async authenticateIntegrationToken(
    request: { user?: unknown },
    token: string,
  ): Promise<boolean> {
    const user = await this.integrationService.authenticate(token);
    if (!user) {
      throw new UnauthorizedException('个人访问令牌无效、已过期或已撤销');
    }
    request.user = user;
    return true;
  }
}
