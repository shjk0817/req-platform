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
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ProjectStatus, ProjectUpdateKind } from '@prisma/client';

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

  @ApiPropertyOptional({ description: '需要的能力标签，与业务标签分开用于匹配合适同事', example: ['报表', '数据导出'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: '所需能力最多 10 项' })
  @IsString({ each: true })
  requiredSkills?: string[];

  @ApiPropertyOptional({ description: '逐条验收标准，发布后由需求方试用确认' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20, { message: '验收条目最多 20 条' })
  @IsString({ each: true })
  acceptanceItems?: string[];

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

  @ApiPropertyOptional({ description: '需要的能力标签' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: '所需能力最多 10 项' })
  @IsString({ each: true })
  requiredSkills?: string[];

  @ApiPropertyOptional({ description: '逐条验收标准；为空时保留原有条目' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20, { message: '验收条目最多 20 条' })
  @IsString({ each: true })
  acceptanceItems?: string[];

  @ApiPropertyOptional({ description: '任务头像标识，取自预设列表（如 task-01）' })
  @IsOptional()
  @IsString()
  @MaxLength(300, { message: '头像取值过长' })
  avatar?: string;

  @ApiPropertyOptional({ description: '期望交付时间' })
  @IsOptional()
  @IsDateString({}, { message: '期望交付时间格式不正确' })
  expectedAt?: string;

  @ApiPropertyOptional({ description: '成果展示地址，例如内部部署后的工具地址' })
  @IsOptional()
  @IsUrl({ require_protocol: true }, { message: '成果展示地址必须是完整 URL' })
  @MaxLength(500, { message: '成果展示地址最多 500 个字符' })
  demoUrl?: string;
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

  @ApiPropertyOptional({ description: '只看已逾期项目' })
  @IsOptional()
  overdue?: boolean;
}

/** 仓库创建时可填写的可读命名 */
export class RepositoryNamingDto {
  @ApiPropertyOptional({ description: 'Gitea 仓库英文名；不填时由系统自动生成', example: 'monthly-report-tool' })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: '仓库名最多 100 个字符' })
  repoName?: string;

  @ApiPropertyOptional({ description: '仓库中文别名，用于平台展示', example: '月度报表工具' })
  @IsOptional()
  @IsString()
  @MaxLength(120, { message: '仓库中文别名最多 120 个字符' })
  repoDisplayName?: string;
}

/** 认领项目 */
export class ClaimProjectDto extends RepositoryNamingDto {
  @ApiPropertyOptional({ description: '认领留言：说明实现思路或排期' })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '认领留言最多 500 个字符' })
  remark?: string;
}

/** 手动创建或修复项目仓库 */
export class CreateRepositoryDto extends RepositoryNamingDto {}

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

  @ApiPropertyOptional({ description: '关闭或状态变更说明' })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '说明最多 500 个字符' })
  remark?: string;
}

/** 交还项目 */
export class ReturnProjectDto {
  @ApiPropertyOptional({ description: '超过认领 10 分钟后必须填写交还原因' })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '交还原因最多 500 个字符' })
  remark?: string;
}

/** 催办项目 */
export class NudgeProjectDto {
  @ApiPropertyOptional({ description: '给负责人的补充说明' })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '催办说明最多 500 个字符' })
  remark?: string;
}

/** 新增项目沟通或追加需求 */
export class CreateProjectUpdateDto {
  @ApiProperty({ description: '记录类型', enum: ProjectUpdateKind })
  @IsEnum(ProjectUpdateKind, { message: '记录类型不合法' })
  kind!: ProjectUpdateKind;

  @ApiProperty({ description: '沟通或追加需求正文' })
  @IsString()
  @MinLength(1, { message: '内容不能为空' })
  @MaxLength(5000, { message: '内容最多 5000 个字符' })
  content!: string;
}

/** 逐条提交试用验收结果 */
export class SubmitAcceptanceDto {
  @ApiProperty({ description: '验收条目结果', example: [{ id: 'ckx', result: 'PASSED' }] })
  @IsArray()
  @ArrayMaxSize(20, { message: '验收条目最多 20 条' })
  items!: Array<{ id: string; result: 'PENDING' | 'PASSED' | 'FAILED'; note?: string }>;

  @ApiPropertyOptional({ description: '没有验收条目时的整体试用说明' })
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: '试用说明最多 1000 个字符' })
  remark?: string;
}
