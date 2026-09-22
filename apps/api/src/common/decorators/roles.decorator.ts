/**
 * @Roles 装饰器
 * 作用：声明接口所需角色，配合 RolesGuard 做接口级权限控制
 */
import { Role } from '@prisma/client';
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/** 声明可访问该接口的角色列表 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
