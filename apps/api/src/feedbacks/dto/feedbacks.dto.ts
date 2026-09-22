/**
 * 反馈相关 DTO
 * 作用：定义反馈提交、查询、评论与状态流转的入参校验规则
 */
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { FeedbackStatus, FeedbackType } from '@prisma/client';

/** 提交反馈 */
export class CreateFeedbackDto {
  @ApiProperty({ description: '反馈类型', enum: FeedbackType })
  @IsEnum(FeedbackType, { message: '反馈类型不合法' })
  type!: FeedbackType;

  @ApiProperty({ description: '反馈标题', example: '导出 Excel 时中文乱码' })
  @IsString()
  @MinLength(4, { message: '标题至少 4 个字符' })
  @MaxLength(120, { message: '标题最多 120 个字符' })
  title!: string;

  @ApiProperty({ description: '反馈详细内容：现象、复现步骤、期望结果' })
  @IsString()
  @MinLength(10, { message: '反馈内容至少 10 个字符' })
  @MaxLength(3000, { message: '反馈内容最多 3000 个字符' })
  content!: string;
}

/** 反馈列表查询 */
export class ListFeedbackQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '反馈状态', enum: FeedbackStatus })
  @IsOptional()
  @IsEnum(FeedbackStatus, { message: '反馈状态不合法' })
  status?: FeedbackStatus;

  @ApiPropertyOptional({ description: '反馈类型', enum: FeedbackType })
  @IsOptional()
  @IsEnum(FeedbackType, { message: '反馈类型不合法' })
  type?: FeedbackType;

  @ApiPropertyOptional({ description: '查询范围', enum: ['project', 'mine', 'assigned'] })
  @IsOptional()
  @IsEnum(['project', 'mine', 'assigned'], { message: '查询范围不合法' })
  scope?: 'project' | 'mine' | 'assigned';
}

/** 追加评论 */
export class CreateFeedbackCommentDto {
  @ApiProperty({ description: '评论内容' })
  @IsString()
  @MinLength(1, { message: '评论内容不能为空' })
  @MaxLength(2000, { message: '评论最多 2000 个字符' })
  content!: string;
}

/** 更新反馈状态 */
export class UpdateFeedbackStatusDto {
  @ApiProperty({ description: '目标状态', enum: FeedbackStatus })
  @IsEnum(FeedbackStatus, { message: '反馈状态不合法' })
  status!: FeedbackStatus;

  @ApiPropertyOptional({ description: '状态变更说明，会同步到 Issue 评论' })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '说明最多 500 个字符' })
  remark?: string;
}
