/**
 * 附件相关 DTO
 * 作用：定义上传附件的接口响应结构与查询参数
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AttachmentKind } from '@prisma/client';
import { IsOptional, IsString } from 'class-validator';

/** 附件信息（返回给前端） */
export class AttachmentDto {
  @ApiProperty({ description: '附件主键' })
  id!: string;

  @ApiProperty({ description: '附件类型', enum: AttachmentKind })
  kind!: AttachmentKind;

  @ApiProperty({ description: '原始文件名' })
  name!: string;

  @ApiProperty({ description: 'MIME 类型' })
  mime!: string;

  @ApiProperty({ description: '文件大小（字节）' })
  size!: number;

  @ApiProperty({ description: '在线预览地址' })
  url!: string;

  @ApiProperty({ description: '下载地址' })
  downloadUrl!: string;

  @ApiProperty({ description: '上传时间' })
  createdAt!: string;
}

/** 附件下载查询参数 */
export class AttachmentRawQueryDto {
  // 注意：全局 ValidationPipe 开启了 whitelist，没有校验装饰器的字段会被丢弃，
  //      因此这里必须加上 @IsOptional 等校验装饰器，否则 download 参数不会生效
  @ApiPropertyOptional({ description: '传 1（或 true）表示按附件下载，否则图片内联预览' })
  @IsOptional()
  @IsString({ message: 'download 参数格式不正确' })
  download?: string;
}
