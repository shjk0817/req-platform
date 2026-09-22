/**
 * 附件服务
 * 作用：负责图片与附件的落盘、元数据记录、下载流式输出，以及把附件挂到需求上
 * 说明：
 *   1. 文件保存在容器内 UPLOAD_DIR 目录（由 docker volume 持久化），文件名使用 cuid，
 *      避免重名与恶意文件名；原始文件名只记录在数据库里，下载时再回显；
 *   2. 图片按 image/* 自动识别为 IMAGE，用于需求页画廊展示；其余作为可下载附件；
 *   3. 附件访问地址带随机主键，属于「不可猜测链接」，内网场景下可直接内联预览。
 */
import { AttachmentDto } from './dto/uploads.dto';
import { PrismaService } from '../prisma/prisma.service';
import { Injectable, Logger, NotFoundException, PayloadTooLargeException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Attachment, AttachmentKind } from '@prisma/client';
import { createReadStream } from 'node:fs';
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, extname } from 'node:path';
import type { Response } from 'express';

/** 上传文件的最小结构（来自 multer 临时落盘存储，测试也可传入 buffer） */
export interface UploadedFileLike {
  /** 表单字段名 */
  fieldname: string;
  /** 客户端原始文件名 */
  originalname: string;
  /** MIME 类型 */
  mimetype: string;
  /** 文件大小（字节） */
  size: number;
  /** 文件临时路径 */
  path?: string;
  /** 文件内容（兼容单测与其他调用方） */
  buffer?: Buffer;
}

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** 上传目录（容器内绝对路径） */
  private get uploadDir(): string {
    return this.config.get<string>('upload.dir') ?? '/app/uploads';
  }

  /** 所有文件的大小上限（MB），不按扩展名限制内容格式 */
  private get maxMb(): number {
    return this.config.get<number>('upload.maxMb') ?? 100;
  }

  /** 保存自定义头像：只接受图片，并使用更严格的头像大小上限 */
  async saveAvatar(uploaderId: string, file?: UploadedFileLike): Promise<AttachmentDto> {
    const avatarMaxMb = this.config.get<number>('upload.avatarMaxMb') ?? 5;
    if (!file || (!file.path && (!file.buffer || file.buffer.length === 0))) {
      throw new BadRequestException('未接收到头像图片');
    }
    if (!file.mimetype.toLowerCase().startsWith('image/')) {
      await this.removeTemporaryFile(file);
      throw new BadRequestException('头像必须是图片格式');
    }
    if (file.size > avatarMaxMb * 1024 * 1024) {
      await this.removeTemporaryFile(file);
      throw new PayloadTooLargeException(`头像大小不能超过 ${avatarMaxMb}MB`);
    }
    return this.save(uploaderId, file);
  }

  /**
   * 保存上传的文件并写入元数据
   * @param uploaderId 上传人主键
   * @param file 上传的文件
   */
  async save(uploaderId: string, file?: UploadedFileLike): Promise<AttachmentDto> {
    if (!file || (!file.path && (!file.buffer || file.buffer.length === 0))) {
      throw new BadRequestException('未接收到文件内容');
    }

    const isImage = file.mimetype.toLowerCase().startsWith('image/');
    const kind: AttachmentKind = isImage ? AttachmentKind.IMAGE : AttachmentKind.FILE;

    if (file.size > this.maxMb * 1024 * 1024) {
      await this.removeTemporaryFile(file);
      throw new PayloadTooLargeException(`文件大小不能超过 ${this.maxMb}MB`);
    }

    // 目录按年月分片，避免单目录文件过多
    const now = new Date();
    const relativeDir = join(String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'));
    const extension = extname(file.originalname).toLowerCase();
    const safeExtension = isImage ? extension || `.${file.mimetype.split('/')[1]}` : extension;
    const fileName = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}${safeExtension}`;
    const storagePath = join(relativeDir, fileName);

    const absoluteDir = join(this.uploadDir, relativeDir);
    await mkdir(absoluteDir, { recursive: true });
    const absolutePath = join(this.uploadDir, storagePath);
    if (file.path) {
      await rename(file.path, absolutePath);
    } else if (file.buffer) {
      await writeFile(absolutePath, file.buffer);
    }

    try {
      const attachment = await this.prisma.attachment.create({
        data: {
          uploaderId,
          kind,
          name: this.normalizeName(file.originalname),
          mime: file.mimetype,
          size: file.size,
          storagePath,
        },
      });

      this.logger.log(`附件已上传: ${attachment.id} (${attachment.kind}, ${attachment.size} 字节)`);
      return this.toDto(attachment);
    } catch (error) {
      await unlink(absolutePath).catch(() => undefined);
      throw error;
    }
  }

  /** 清理超限或校验失败时留下的临时文件 */
  private async removeTemporaryFile(file: UploadedFileLike): Promise<void> {
    if (file.path) {
      await unlink(file.path).catch(() => undefined);
    }
  }

  /**
   * 把已上传的附件挂到需求上
   * @param ids 附件主键集合
   * @param projectId 需求主键
   * @param uploaderId 需求方主键，只允许挂自己刚上传的附件
   */
  async attachToProject(ids: string[], projectId: string, uploaderId: string): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.prisma.attachment.updateMany({
      where: { id: { in: ids }, uploaderId, projectId: null },
      data: { projectId },
    });
    const linked = await this.prisma.attachment.count({ where: { projectId, id: { in: ids } } });
    if (linked !== ids.length) {
      this.logger.warn(`部分附件未能挂载到需求 ${projectId}（可能有非本人上传的附件）`);
    }
  }

  /**
   * 查询附件记录（供下载与权限校验复用）
   * @param id 附件主键
   */
  async getById(id: string): Promise<Attachment> {
    const attachment = await this.prisma.attachment.findUnique({ where: { id } });
    if (!attachment) {
      throw new NotFoundException('附件不存在或已删除');
    }
    return attachment;
  }

  /**
   * 以流的方式输出附件内容
   * @param attachment 附件记录
   * @param download 是否强制下载
   * @param res Express 响应对象
   */
  async pipeToResponse(attachment: Attachment, download: boolean, res: Response): Promise<void> {
    const absolutePath = join(this.uploadDir, attachment.storagePath);
    try {
      await stat(absolutePath);
    } catch {
      throw new NotFoundException('附件文件已丢失，请联系管理员');
    }

    res.setHeader('Content-Type', attachment.mime || 'application/octet-stream');
    res.setHeader('Content-Length', String(attachment.size));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    if (download || attachment.kind !== AttachmentKind.IMAGE) {
      // 文件名可能是中文，使用 RFC 5987 编码，避免浏览器乱码
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
      );
    } else {
      res.setHeader('Content-Disposition', 'inline');
    }

    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(absolutePath);
      stream.on('error', reject);
      stream.on('end', () => resolve());
      stream.pipe(res);
    });
  }

  /** 统计并返回未被关联的附件（供清理任务使用） */
  async countOrphans(): Promise<number> {
    return this.prisma.attachment.count({ where: { projectId: null } });
  }

  /**
   * 清理长期未被挂到需求上的附件（上传后中途放弃发布）
   * @param olderThanHours 超过多少小时未关联即清理
   */
  async cleanupOrphans(olderThanHours = 24): Promise<number> {
    const deadline = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
    const orphans = await this.prisma.attachment.findMany({
      where: { projectId: null, avatarUser: null, createdAt: { lt: deadline } },
      select: { id: true, storagePath: true },
    });
    for (const orphan of orphans) {
      await unlink(join(this.uploadDir, orphan.storagePath)).catch(() => undefined);
    }
    if (orphans.length > 0) {
      await this.prisma.attachment.deleteMany({ where: { id: { in: orphans.map((item) => item.id) } } });
      this.logger.log(`已清理未关联附件 ${orphans.length} 个`);
    }
    return orphans.length;
  }

  /** 转换数据库记录为对外结构 */
  toDto(attachment: Attachment): AttachmentDto {
    return {
      id: attachment.id,
      kind: attachment.kind,
      name: attachment.name,
      mime: attachment.mime,
      size: attachment.size,
      url: `/api/uploads/${attachment.id}/raw`,
      downloadUrl: `/api/uploads/${attachment.id}/raw?download=1`,
      createdAt: attachment.createdAt.toISOString(),
    };
  }

  /** 规整原始文件名，去掉路径与过长部分 */
  private normalizeName(name: string): string {
    const base = name.split(/[/\\]/).pop() ?? 'attachment';
    return base.slice(0, 200) || 'attachment';
  }

  /** 确保上传目录存在（应用启动时调用） */
  async ensureDir(): Promise<void> {
    await mkdir(this.uploadDir, { recursive: true });
    await mkdir(dirname(join(this.uploadDir, 'placeholder')), { recursive: true });
  }
}
