/**
 * Prisma 数据库服务
 * 作用：封装 PrismaClient 的生命周期，作为全局单例注入到各业务模块
 */
import { INestApplication, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /** 模块初始化时建立数据库连接 */
  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('数据库连接已建立');
  }

  /** 模块销毁时断开数据库连接 */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('数据库连接已断开');
  }

  /** 应用优雅关闭钩子：避免容器重启时连接泄漏 */
  enableShutdownHooks(app: INestApplication): void {
    process.on('beforeExit', () => {
      void app.close();
    });
  }
}
