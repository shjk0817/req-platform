/**
 * 健康检查控制器
 * 作用：供容器编排与反向代理探活
 */
import { PrismaService } from './prisma/prisma.service';
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './common/decorators/public.decorator';

@ApiTags('系统')
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** 存活探针 */
  @Public()
  @Get('health')
  @ApiOperation({ summary: '健康检查' })
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /** 就绪探针：同时校验数据库连通性 */
  @Public()
  @Get('ready')
  @ApiOperation({ summary: '就绪检查（含数据库连通性）' })
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'connected' };
    } catch (error) {
      return { status: 'degraded', database: 'disconnected', message: (error as Error).message };
    }
  }
}
