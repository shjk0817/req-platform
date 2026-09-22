/**
 * 机器客户端模块
 * 作用：装配个人访问令牌、令牌认证与 Agent 审计基础能力
 */
import { IntegrationController } from './integration.controller';
import { IntegrationService } from './integration.service';
import { Module } from '@nestjs/common';

@Module({
  controllers: [IntegrationController],
  providers: [IntegrationService],
  exports: [IntegrationService],
})
export class IntegrationModule {}
