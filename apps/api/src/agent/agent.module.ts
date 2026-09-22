/**
 * Agent API 模块
 * 作用：装配稳定的机器接口与审计，并复用项目、反馈、通知领域服务
 */
import { AgentController } from './agent.controller';
import { AgentAuditService } from './agent-audit.service';
import { AgentService } from './agent.service';
import { FeedbacksModule } from '../feedbacks/feedbacks.module';
import { ProjectsModule } from '../projects/projects.module';
import { IntegrationModule } from '../integrations/integration.module';
import { Module } from '@nestjs/common';

@Module({
  imports: [ProjectsModule, FeedbacksModule, IntegrationModule],
  controllers: [AgentController],
  providers: [AgentService, AgentAuditService],
  exports: [AgentService],
})
export class AgentModule {}
