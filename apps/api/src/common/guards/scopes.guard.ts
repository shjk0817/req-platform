/**
 * 机器令牌范围守卫
 * 作用：仅允许带有足够 scope 的个人访问令牌调用 Agent API
 */
import { SCOPES_KEY } from '../decorators/scopes.decorator';
import { AuthUser } from '../interfaces/auth-user.interface';
import { ForbiddenException, CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IntegrationScope } from '../../integrations/integration.constants';

@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /** 校验当前请求是否具备接口声明的所有权限范围 */
  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<IntegrationScope[]>(SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }
    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (user?.authMethod !== 'pat' || !required.every((scope) => user.scopes?.includes(scope))) {
      throw new ForbiddenException('个人访问令牌权限范围不足');
    }
    return true;
  }
}
