/**
 * 统计控制器
 * 作用：对外提供贡献热力图与贡献概览接口
 */
import { HeatmapQueryDto } from './dto/stats.dto';
import { StatsService } from './stats.service';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('统计')
@ApiBearerAuth()
@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  /** 贡献热力图：全平台或指定同事 */
  @Get('heatmap')
  @ApiOperation({ summary: '贡献热力图（不传 userId 为全平台汇总）' })
  heatmap(@Query() query: HeatmapQueryDto) {
    return this.statsService.heatmap(query.userId, query.months ?? 12);
  }

  /** 贡献概览：各类行为累计数量 */
  @Get('summary')
  @ApiOperation({ summary: '贡献概览（不传 userId 为全平台汇总）' })
  summary(@Query() query: HeatmapQueryDto) {
    return this.statsService.summary(query.userId);
  }
}
