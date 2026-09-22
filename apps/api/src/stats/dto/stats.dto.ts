/**
 * 行为热力图查询 DTO
 * 作用：定义统计范围与统计对象（全平台 / 指定同事）
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** 热力图查询条件 */
export class HeatmapQueryDto {
  @ApiPropertyOptional({ description: '统计对象用户主键；不传表示全平台汇总' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: '统计最近多少个月，默认 12', example: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '统计月数必须为整数' })
  @Min(1, { message: '统计月数至少为 1' })
  @Max(24, { message: '统计月数最多为 24' })
  months?: number;
}
