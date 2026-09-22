/**
 * 分页查询通用 DTO
 * 作用：统一列表接口的分页、搜索与排序参数
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  @ApiPropertyOptional({ description: '页码，从 1 开始', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '页码必须是整数' })
  @Min(1, { message: '页码最小为 1' })
  page: number = 1;

  @ApiPropertyOptional({ description: '每页条数', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '每页条数必须是整数' })
  @Min(1)
  @Max(100, { message: '每页最多 100 条' })
  pageSize: number = 20;

  @ApiPropertyOptional({ description: '关键字模糊搜索' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ description: '排序字段', default: 'createdAt' })
  @IsOptional()
  @IsString()
  sortBy: string = 'createdAt';

  @ApiPropertyOptional({ description: '排序方向', enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'], { message: '排序方向只能是 asc 或 desc' })
  order: 'asc' | 'desc' = 'desc';

  /** 转换为 Prisma 分页参数 */
  get skip(): number {
    return (this.page - 1) * this.pageSize;
  }

  /** 转换为 Prisma 排序参数 */
  get orderBy(): Record<string, 'asc' | 'desc'> {
    return { [this.sortBy]: this.order };
  }
}

/** 统一的分页返回结构 */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * 构造分页返回结构
 * @param items 当前页数据
 * @param total 总条数
 * @param query 分页查询参数
 */
export function buildPaginated<T>(items: T[], total: number, query: PaginationQueryDto): PaginatedResult<T> {
  return {
    items,
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.ceil(total / query.pageSize) || 0,
  };
}
