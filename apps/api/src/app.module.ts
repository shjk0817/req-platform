/**
 * 应用根模块
 * 作用：装配配置、数据库、队列、通知与各业务模块，并注册全局守卫
 */
import configuration from './config/configuration';
import { AdminBootstrapService } from './bootstrap/admin-bootstrap.service';
import { AuthModule } from './auth/auth.module';
import { FeedbacksModule } from './feedbacks/feedbacks.module';
import { GiteaModule } from './gitea/gitea.module';
import { HealthController } from './health.controller';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsModule } from './projects/projects.module';
import { QueueModule } from './queue/queue.module';
import { RolesGuard } from './common/guards/roles.guard';
import { StatsModule } from './stats/stats.module';
import { TasksModule } from './tasks/tasks.module';
import { UploadsModule } from './uploads/uploads.module';
import { UsersModule } from './users/users.module';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    // 配置模块全局可用
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], envFilePath: ['.env'] }),
    ScheduleModule.forRoot(),
    PrismaModule,
    QueueModule,
    NotificationsModule,
    GiteaModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    FeedbacksModule,
    StatsModule,
    UploadsModule,
    TasksModule,
  ],
  controllers: [HealthController],
  providers: [
    // 首次启动时确保存在管理员账号
    AdminBootstrapService,
    // 全局登录校验：未标记 @Public 的接口都需要合法 Token
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // 全局角色校验：配合 @Roles 使用
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
