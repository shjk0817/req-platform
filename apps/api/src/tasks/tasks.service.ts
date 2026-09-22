/**
 * 定时任务服务
 * 作用：处理平台周期性的提醒工作，避免需求长期无人认领或反馈长期无人处理
 */
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FeedbackStatus, NotificationType, ProjectStatus } from '@prisma/client';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly uploads: UploadsService,
  ) {}

  /**
   * 每周一早上 9 点：提醒创建者关注长期无人认领的需求
   * 定时表达式：分 时 日 月 周
   */
  @Cron('0 9 * * 1')
  async remindUnclaimedProjects(): Promise<void> {
    const deadline = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const projects = await this.prisma.project.findMany({
      where: { status: ProjectStatus.OPEN, createdAt: { lt: deadline } },
      select: { id: true, title: true, creatorId: true },
    });
    if (projects.length === 0) {
      return;
    }

    for (const project of projects) {
      await this.notifications.create({
        userId: project.creatorId,
        type: NotificationType.PROJECT_OVERDUE,
        title: `需求「${project.title}」尚未被认领`,
        content: '该需求已发布超过 7 天仍未被认领，建议补充需求细节或联系相关同事。',
        link: `/projects/${project.id}`,
        sendMail: false,
        dedupeWindowDays: 7,
      });
    }
    this.logger.log(`已发送 ${projects.length} 条未认领需求提醒`);
  }

  /**
   * 每天早上 9 点：提醒项目负责人处理超期反馈
   */
  @Cron('30 9 * * *')
  async remindStaleFeedbacks(): Promise<void> {
    const deadline = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const feedbacks = await this.prisma.feedback.findMany({
      where: { status: FeedbackStatus.OPEN, createdAt: { lt: deadline } },
      include: { project: { select: { id: true, title: true, ownerId: true } } },
      take: 200,
    });

    for (const feedback of feedbacks) {
      if (!feedback.project.ownerId) {
        continue;
      }
      await this.notifications.create({
        userId: feedback.project.ownerId,
        type: NotificationType.FEEDBACK_CREATED,
        title: `反馈「${feedback.title}」待处理`,
        content: `项目「${feedback.project.title}」中的该反馈已提交超过 3 天，请及时跟进。`,
        link: `/projects/${feedback.project.id}?tab=feedback&feedbackId=${feedback.id}`,
        sendMail: false,
        dedupeWindowDays: 7,
      });
    }
    if (feedbacks.length > 0) {
      this.logger.log(`已发送 ${feedbacks.length} 条反馈超期提醒`);
    }
  }

  /**
   * 每天凌晨 3 点：清理「已上传但未发布需求」的孤儿附件，避免磁盘被占满
   */
  @Cron('0 3 * * *')
  async cleanupOrphanAttachments(): Promise<void> {
    await this.uploads.cleanupOrphans(24);
  }
}
