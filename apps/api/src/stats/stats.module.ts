/**
 * 统计模块
 * 作用：装配统计服务与控制器，供工作台与个人页展示贡献热力图
 */
import { PrismaModule } from '../prisma/prisma.module';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';
import { Module } from '@nestjs/common';

@Module({
  imports: [PrismaModule],
  controllers: [StatsController],
  providers: [StatsService],
  exports: [StatsService],
})
export class StatsModule {}
