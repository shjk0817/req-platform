/**
 * @Public 装饰器
 * 作用：标记无需登录即可访问的接口，配合全局 JWT 守卫使用
 */
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** 标记接口为公开访问 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
