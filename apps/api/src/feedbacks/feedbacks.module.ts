/**
 * 反馈模块
 * 作用：装配反馈与仓库 Issue 的联动能力
 */
import { FeedbacksController, ProjectFeedbacksController } from './feedbacks.controller';
import { FeedbacksService } from './feedbacks.service';
import { GiteaModule } from '../gitea/gitea.module';
import { ProjectsModule } from '../projects/projects.module';
import { Module } from '@nestjs/common';

@Module({
  imports: [GiteaModule, ProjectsModule],
  controllers: [FeedbacksController, ProjectFeedbacksController],
  providers: [FeedbacksService],
  exports: [FeedbacksService],
})
export class FeedbacksModule {}
