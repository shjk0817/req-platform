/**
 * 定时任务模块
 * 作用：注册平台周期性任务（未认领提醒、反馈超期提醒、孤儿附件清理）
 */
import { TasksService } from './tasks.service';
import { PrismaModule } from '../prisma/prisma.module';
import { UploadsModule } from '../uploads/uploads.module';
import { Module } from '@nestjs/common';

@Module({
  imports: [PrismaModule, UploadsModule],
  providers: [TasksService],
})
export class TasksModule {}
