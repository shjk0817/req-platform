/**
 * 用户控制器
 * 作用：提供个人资料维护、同事检索与管理员审核接口
 */
import { ListUsersQueryDto, ReviewUserDto, UpdateProfileDto } from './dto/users.dto';
import { UsersService } from './users.service';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Body, Controller, Get, Param, Patch, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { UploadedFileLike } from '../uploads/uploads.service';

/** 自定义头像临时落盘目录 */
const AVATAR_TEMP_DIR = process.env.UPLOAD_TEMP_DIR ?? '/tmp/aimanager-uploads';

@ApiTags('用户')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** 查询同事列表（挑选协作同事时可参考） */
  @Get('developers')
  @ApiOperation({ summary: '查询同事列表（用于挑选协作或共同需求人）' })
  listDevelopers(@Query() query: PaginationQueryDto) {
    return this.usersService.listDevelopers(query);
  }

  /** 管理员查询用户列表 */
  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: '管理员分页查询用户列表' })
  list(@Query() query: ListUsersQueryDto) {
    return this.usersService.list(query);
  }

  /** 查询指定用户详情 */
  @Get(':id')
  @ApiOperation({ summary: '查询用户详情' })
  getById(@Param('id') id: string) {
    return this.usersService.getById(id);
  }

  /** 修改当前用户资料 */
  @Put('profile')
  @ApiOperation({ summary: '修改个人资料与能力标签' })
  updateProfile(@CurrentUser('id') userId: string, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(userId, dto);
  }

  /** 上传并设置当前用户的自定义头像 */
  @Post('profile/avatar')
  @ApiOperation({ summary: '上传并设置自定义头像' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_request, _file, callback) => {
          mkdirSync(AVATAR_TEMP_DIR, { recursive: true });
          callback(null, AVATAR_TEMP_DIR);
        },
        filename: (_request, _file, callback) => {
          callback(null, `${randomUUID()}.avatar`);
        },
      }),
      limits: { fileSize: Number(process.env.AVATAR_MAX_MB ?? 5) * 1024 * 1024 },
    }),
  )
  uploadAvatar(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: UploadedFileLike,
  ) {
    return this.usersService.updateAvatarFromUpload(userId, file);
  }

  /** 管理员审核注册申请 */
  @Patch(':id/review')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: '管理员审核注册申请（通过 / 驳回 / 停用 / 启用）' })
  review(@CurrentUser('id') adminId: string, @Param('id') id: string, @Body() dto: ReviewUserDto) {
    return this.usersService.review(adminId, id, dto);
  }

  /** 管理员重置用户的 Git 账号密码 */
  @Post(':id/reset-gitea-password')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: '重置用户的 Git 账号密码' })
  resetGiteaPassword(@Param('id') id: string) {
    return this.usersService.resetGiteaPassword(id);
  }
}
