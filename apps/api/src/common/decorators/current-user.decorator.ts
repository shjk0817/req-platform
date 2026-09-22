/**
 * @CurrentUser 参数装饰器
 * 作用：在控制器方法中直接获取当前登录用户信息
 */
import { AuthUser } from '../interfaces/auth-user.interface';
import { ExecutionContext, createParamDecorator } from '@nestjs/common';

/** 取出请求上挂载的登录用户；传入字段名时返回该字段值 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthUser | undefined, ctx: ExecutionContext): AuthUser | AuthUser[keyof AuthUser] => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
    const user = request.user;
    return field ? user?.[field] : user;
  },
);
