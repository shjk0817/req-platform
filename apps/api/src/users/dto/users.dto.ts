/**
 * 用户管理 DTO
 * 作用：定义用户列表查询、资料修改、管理员审核等入参校验规则
 */
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Role, UserStatus } from '@prisma/client';

/** 用户列表查询 */
export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '账号状态', enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus, { message: '账号状态不合法' })
  status?: UserStatus;

  @ApiPropertyOptional({ description: '角色', enum: Role })
  @IsOptional()
  @IsEnum(Role, { message: '角色不合法' })
  role?: Role;
}

/** 修改个人资料 */
export class UpdateProfileDto {
  @ApiPropertyOptional({ description: '姓名' })
  @IsOptional()
  @IsString()
  @MaxLength(32, { message: '姓名最多 32 个字符' })
  name?: string;

  @ApiPropertyOptional({ description: '所属部门' })
  @IsOptional()
  @IsString()
  @MaxLength(64, { message: '部门名称最多 64 个字符' })
  department?: string;

  @ApiPropertyOptional({ description: '能力标签，用于需求方筛选开发者' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20, { message: '能力标签最多 20 个' })
  @IsString({ each: true })
  skills?: string[];

  @ApiPropertyOptional({ description: '头像标识，取自预设列表（如 user-01）', example: 'user-01' })
  @IsOptional()
  @IsString()
  @MaxLength(300, { message: '头像取值过长' })
  avatarUrl?: string;
}

/** 管理员审核操作 */
export class ReviewUserDto {
  @ApiPropertyOptional({ description: '审核动作', enum: ['approve', 'reject', 'disable', 'enable'] })
  @IsIn(['approve', 'reject', 'disable', 'enable'], { message: '审核动作不合法' })
  action!: 'approve' | 'reject' | 'disable' | 'enable';

  @ApiPropertyOptional({ description: '审核备注，会通过通知发送给申请人' })
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: '备注最多 200 个字符' })
  remark?: string;
}
