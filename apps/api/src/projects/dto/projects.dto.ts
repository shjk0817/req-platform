/**
 * 项目（需求单）相关 DTO
 * 作用：定义需求发布、查询、认领、成员维护等入参校验规则
 */
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ProjectStatus } from '@prisma/client';

/** 发布需求 */
export class CreateProjectDto {
  @ApiProperty({ description: '需求标题', example: '生产报表自动导出工具' })
  @IsString()
  @MinLength(4, { message: '标题至少 4 个字符' })
  @MaxLength(120, { message: '标题最多 120 个字符' })
  title!: string;

  @ApiProperty({ description: '需求详细描述：背景、现状、期望效果' })
  @IsString()
  @MinLength(10, { message: '需求描述至少 10 个字符' })
  @MaxLength(5000, { message: '需求描述最多 5000 个字符' })
  description!: string;

  @ApiPropertyOptional({ description: '验收标准' })
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: '验收标准最多 2000 个字符' })
  acceptanceCriteria?: string;

  @ApiPropertyOptional({ description: '需求标签', example: ['报表', '自动化'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: '标签最多 10 个' })
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: '任务头像标识，取自预设列表（如 task-01）', example: 'task-01' })
  @IsOptional()
  @IsString()
  @MaxLength(300, { message: '头像取值过长' })
  avatar?: string;

  @ApiPropertyOptional({ description: '需求图片附件主键列表（先调 /uploads 上传后传入）' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12, { message: '图片最多 12 张' })
  @IsString({ each: true })
  imageIds?: string[];

  @ApiPropertyOptional({ description: '需求附件主键列表（先调 /uploads 上传后传入）' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20, { message: '附件最多 20 个' })
  @IsString({ each: true })
  attachmentIds?: string[];

  @ApiPropertyOptional({ description: '期望交付时间（ISO 日期字符串）' })
  @IsOptional()
  @IsDateString({}, { message: '期望交付时间格式不正确' })
  expectedAt?: string;
}

/** 修改需求 */
export class UpdateProjectDto {
  @ApiPropertyOptional({ description: '需求标题' })
  @IsOptional()
  @IsString()
  @MinLength(4, { message: '标题至少 4 个字符' })
  @MaxLength(120, { message: '标题最多 120 个字符' })
  title?: string;

  @ApiPropertyOptional({ description: '需求详细描述' })
  @IsOptional()
  @IsString()
  @MinLength(10, { message: '需求描述至少 10 个字符' })
  @MaxLength(5000, { message: '需求描述最多 5000 个字符' })
  description?: string;

  @ApiPropertyOptional({ description: '验收标准' })
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: '验收标准最多 2000 个字符' })
  acceptanceCriteria?: string;

  @ApiPropertyOptional({ description: '需求标签' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: '标签最多 10 个' })
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: '任务头像标识，取自预设列表（如 task-01）' })
  @IsOptional()
  @IsString()
  @MaxLength(300, { message: '头像取值过长' })
  avatar?: string;

  @ApiPropertyOptional({ description: '期望交付时间' })
  @IsOptional()
  @IsDateString({}, { message: '期望交付时间格式不正确' })
  expectedAt?: string;
}

/** 项目列表查询 */
export class ListProjectsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '项目状态', enum: ProjectStatus })
  @IsOptional()
  @IsEnum(ProjectStatus, { message: '项目状态不合法' })
  status?: ProjectStatus;

  @ApiPropertyOptional({ description: '按标签筛选' })
  @IsOptional()
  @IsString()
  tag?: string;

  @ApiPropertyOptional({
    description: '筛选范围',
    enum: ['all', 'mine', 'created', 'unclaimed', 'developing', 'requesting'],
  })
  @IsOptional()
  @IsEnum(['all', 'mine', 'created', 'unclaimed', 'developing', 'requesting'], {
    message: '筛选范围不合法',
  })
  scope?: 'all' | 'mine' | 'created' | 'unclaimed' | 'developing' | 'requesting';
}

/** 认领项目 */
export class ClaimProjectDto {
  @ApiPropertyOptional({ description: '认领留言：说明实现思路或排期' })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '认领留言最多 500 个字符' })
  remark?: string;
}

/** 添加项目成员 */
export class AddMemberDto {
  @ApiProperty({ description: '要加入项目的用户主键' })
  @IsString()
  userId!: string;
}

/** 添加共同需求人 */
export class AddRequesterDto {
  @ApiPropertyOptional({ description: '要添加的用户主键；不传表示「我也需要」，把自己加入' })
  @IsOptional()
  @IsString()
  userId?: string;
}

/** 更新项目状态 */
export class UpdateProjectStatusDto {
  @ApiProperty({ description: '目标状态', enum: ProjectStatus })
  @Type(() => String)
  @IsEnum(ProjectStatus, { message: '项目状态不合法' })
  status!: ProjectStatus;
}
