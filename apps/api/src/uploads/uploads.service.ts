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
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, extname } from 'node:path';
import type { Response } from 'express';

/** 上传文件的最小结构（来自 multer 内存存储） */
export interface UploadedFileLike {
  /** 表单字段名 */
  fieldname: string;
  /** 客户端原始文件名 */
  originalname: string;
  /** MIME 类型 */
  mimetype: string;
  /** 文件大小（字节） */
  size: number;
  /** 文件内容 */
  buffer: Buffer;
}

/** 允许内联预览的图片类型 */
const IMAGE_MIME_WHITELIST = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/bmp',
];

/** 禁止上传的可执行类扩展名 */
const BLOCKED_EXTENSIONS = [
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bat',
  '.cmd',
  '.com',
  '.scr',
  '.msi',
  '.ps1',
  '.sh',
  '.jar',
  '.app',
  '.dmg',
  '.vbs',
];

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

  /** 单个图片的大小上限（MB） */
  private get imageMaxMb(): number {
    return this.config.get<number>('upload.imageMaxMb') ?? 10;
  }

  /** 单个附件的大小上限（MB） */
  private get fileMaxMb(): number {
    return this.config.get<number>('upload.fileMaxMb') ?? 30;
  }

  /**
   * 保存上传的文件并写入元数据
   * @param uploaderId 上传人主键
   * @param file 上传的文件
   */
  async save(uploaderId: string, file?: UploadedFileLike): Promise<AttachmentDto> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('未接收到文件内容');
    }

    const isImage = IMAGE_MIME_WHITELIST.includes(file.mimetype.toLowerCase());
    const kind: AttachmentKind = isImage ? AttachmentKind.IMAGE : AttachmentKind.FILE;

    // 大小校验：图片与普通附件使用不同上限
    const maxMb = isImage ? this.imageMaxMb : this.fileMaxMb;
    if (file.size > maxMb * 1024 * 1024) {
      throw new PayloadTooLargeException(`${isImage ? '图片' : '附件'}大小不能超过 ${maxMb}MB`);
    }

    const extension = extname(file.originalname).toLowerCase();
    if (!isImage && BLOCKED_EXTENSIONS.includes(extension)) {
      throw new BadRequestException(`出于安全考虑，不允许上传 ${extension} 类型的文件`);
    }

    // 目录按年月分片，避免单目录文件过多
    const now = new Date();
    const relativeDir = join(String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'));
    const safeExtension = isImage ? extension || `.${file.mimetype.split('/')[1]}` : extension;
    const fileName = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}${safeExtension}`;
    const storagePath = join(relativeDir, fileName);

    const absoluteDir = join(this.uploadDir, relativeDir);
    await mkdir(absoluteDir, { recursive: true });
    await writeFile(join(this.uploadDir, storagePath), file.buffer);

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
    res.setHeader('Cache-Control', 'private, max-age=86400');
    if (download) {
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
      where: { projectId: null, createdAt: { lt: deadline } },
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
