/**
 * 机器令牌权限范围装饰器
 * 作用：为 Agent / CLI 接口声明最小必要权限
 */
import { SetMetadata } from '@nestjs/common';
import { IntegrationScope } from '../../integrations/integration.constants';

export const SCOPES_KEY = 'integration_scopes';
export const Scopes = (...scopes: IntegrationScope[]) => SetMetadata(SCOPES_KEY, scopes);
