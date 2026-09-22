/**
 * 角色权限守卫
 * 作用：校验当前登录用户角色是否满足 @Roles 声明的要求
 */
import { AuthUser } from '../interfaces/auth-user.interface';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /** 校验角色是否命中，未声明角色要求的接口直接放行 */
  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;
    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException('没有权限执行该操作');
    }
    return true;
  }
}
