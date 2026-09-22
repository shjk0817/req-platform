/**
 * 项目模块
 * 作用：装配需求发布、认领、附件挂载与仓库联动相关能力
 */
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { GiteaModule } from '../gitea/gitea.module';
import { UploadsModule } from '../uploads/uploads.module';
import { Module } from '@nestjs/common';

@Module({
  imports: [GiteaModule, UploadsModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
