/**
 * 通知服务
 * 作用：生成站内通知并投递邮件任务，是平台所有消息的统一出口
 */
import { EMAIL_QUEUE } from '../queue/queue.constants';
import { PrismaService } from '../prisma/prisma.service';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { NotificationType } from '@prisma/client';
import { Queue } from 'bullmq';
import { PaginationQueryDto, buildPaginated } from '../common/dto/pagination.dto';
import { ConfigService } from '@nestjs/config';

/** 创建通知的入参 */
export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  content: string;
  /** 平台内跳转路径 */
  link?: string;
  /** 是否同时发送邮件（默认 true） */
  sendMail?: boolean;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(EMAIL_QUEUE) private readonly emailQueue: Queue,
    private readonly config: ConfigService,
  ) {}

  /**
   * 创建站内通知，并异步投递邮件
   * @param input 通知内容
   */
  async create(input: CreateNotificationInput) {
    const notification = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        content: input.content,
        link: input.link,
      },
    });

    if (input.sendMail !== false) {
      try {
        const user = await this.prisma.user.findUnique({
          where: { id: input.userId },
          select: { email: true },
        });
        if (user?.email) {
          const appUrl = this.config.get<string>('appUrl') ?? '';
          const link = input.link ? `${appUrl}${input.link}` : appUrl;
          await this.emailQueue.add(
            'send',
            {
              to: user.email,
              subject: `【需求协作平台】${input.title}`,
              text: `${input.content}\n\n查看详情：${link}`,
            },
            {
              attempts: 3,
              backoff: { type: 'exponential', delay: 5000 },
              removeOnComplete: 200,
              removeOnFail: 500,
            },
          );
        }
      } catch (error) {
        // 邮件入队失败不影响站内通知
        this.logger.warn(`邮件任务入队失败: ${(error as Error).message}`);
      }
    }

    return notification;
  }

  /**
   * 批量创建通知（用于项目成员、协作者等场景）
   * @param userIds 接收人列表
   * @param payload 通知内容（不含 userId）
   */
  async createMany(userIds: string[], payload: Omit<CreateNotificationInput, 'userId'>) {
    const unique = [...new Set(userIds)];
    await Promise.all(unique.map((userId) => this.create({ ...payload, userId })));
  }

  /**
   * 分页查询当前用户的通知
   * @param userId 用户主键
   * @param query 分页参数
   */
  async listMine(userId: string, query: PaginationQueryDto) {
    const where = { userId };
    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return buildPaginated(items, total, query);
  }

  /** 统计当前用户未读通知数 */
  async countUnread(userId: string) {
    const count = await this.prisma.notification.count({ where: { userId, read: false } });
    return { count };
  }

  /**
   * 标记单条通知为已读
   * @param userId 用户主键
   * @param id 通知主键
   */
  async markRead(userId: string, id: string) {
    const notification = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!notification) {
      throw new NotFoundException('通知不存在');
    }
    await this.prisma.notification.update({ where: { id }, data: { read: true } });
    return { message: '已标记为已读' };
  }

  /** 标记当前用户全部通知为已读 */
  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
    return { message: '全部通知已标记为已读' };
  }
}
