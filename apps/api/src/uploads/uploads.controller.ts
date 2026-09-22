/**
 * 附件控制器
 * 作用：提供图片 / 附件的上传与下载接口
 * 说明：下载接口标记为 @Public，因为浏览器直接访问 <img>/<a> 无法携带 JWT；
 *      访问地址中的主键为随机 cuid，等同于「不可猜测链接」，内网场景可接受
 */
import { AttachmentDto, AttachmentRawQueryDto } from './dto/uploads.dto';
import { UploadsService, UploadedFileLike } from './uploads.service';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

@ApiTags('附件')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  /** 上传图片或附件（multipart/form-data，字段名 file） */
  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: '上传图片或附件，返回可访问地址（图片自动识别为 IMAGE）' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      // 内存存储：统一在服务里做校验与命名，避免落盘半成品文件
      limits: { fileSize: 30 * 1024 * 1024 },
    }),
  )
  upload(@CurrentUser() user: AuthUser, @UploadedFile() file: UploadedFileLike): Promise<AttachmentDto> {
    return this.uploadsService.save(user.id, file);
  }

  /**
   * 读取附件内容：默认内联预览（图片可直接显示），带 download=1/true 时按附件下载
   */
  @Public()
  @Get(':id/raw')
  @ApiOperation({ summary: '读取附件内容（图片内联预览，download=1 时下载）' })
  async raw(
    @Param('id') id: string,
    @Query() query: AttachmentRawQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const attachment = await this.uploadsService.getById(id);
    const wantDownload = ['1', 'true'].includes((query.download ?? '').toLowerCase());
    await this.uploadsService.pipeToResponse(attachment, wantDownload, res);
  }
}
