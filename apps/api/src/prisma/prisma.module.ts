/**
 * Prisma 全局模块
 * 作用：向所有业务模块提供 PrismaService，避免重复 import
 */
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
