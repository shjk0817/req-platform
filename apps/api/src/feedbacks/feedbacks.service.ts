/**
 * 反馈服务
 * 作用：把平台内的使用反馈与 Gitea 仓库 Issue 双向打通，
 *      实现「使用方提反馈 -> 开发者处理 -> 状态回写」的迭代闭环
 */
import {
  CreateFeedbackCommentDto,
  CreateFeedbackDto,
  ListFeedbackQueryDto,
  UpdateFeedbackStatusDto,
} from './dto/feedbacks.dto';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { buildPaginated, PaginationQueryDto } from '../common/dto/pagination.dto';
import { GiteaService } from '../gitea/gitea.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, FeedbackStatus, FeedbackType, NotificationType, Role } from '@prisma/client';

/** 反馈类型 -> Gitea Issue 标签 */
const TYPE_LABEL: Record<FeedbackType, string> = {
  BUG: 'bug',
  IMPROVEMENT: 'enhancement',
  QUESTION: 'question',
};

/** 反馈类型 -> 中文名称（用于通知与 Issue 正文） */
const TYPE_TEXT: Record<FeedbackType, string> = {
  BUG: '缺陷反馈',
  IMPROVEMENT: '改进建议',
  QUESTION: '使用咨询',
};

@Injectable()
export class FeedbacksService {
  private readonly logger = new Logger(FeedbacksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly gitea: GiteaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * 提交反馈，并同步创建 Gitea Issue
   * @param projectId 项目主键
   * @param userId 提交人主键
   * @param dto 反馈内容
   */
  async create(projectId: string, userId: string, dto: CreateFeedbackDto) {
    const project = await this.projects.getRepositoryInfo(projectId);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const feedback = await this.prisma.feedback.create({
      data: {
        projectId,
        userId,
        type: dto.type,
        title: dto.title,
        content: dto.content,
      },
    });

    // 同步到 Gitea Issue，失败不阻塞反馈提交
    if (project.repoOwner && project.repoName && this.gitea.isConfigured) {
      try {
        const issue = await this.gitea.createIssue(project.repoOwner, project.repoName, {
          title: `[${TYPE_TEXT[dto.type]}] ${dto.title}`,
          body: this.buildIssueBody(dto, user.name),
          labels: [TYPE_LABEL[dto.type]],
        });
        if (issue) {
          await this.prisma.feedback.update({
            where: { id: feedback.id },
            data: { issueNumber: issue.number, issueUrl: issue.html_url },
          });
        }
      } catch (error) {
        this.logger.warn(`同步 Gitea Issue 失败: ${(error as Error).message}`);
      }
    }

    // 通知项目负责人与全体成员
    const members = await this.prisma.projectMember.findMany({
      where: { projectId },
      select: { userId: true },
    });
    const targets = members.map((item) => item.userId);
    if (project.ownerId) {
      targets.push(project.ownerId);
    }
    await this.notifications.createMany(targets.filter((id) => id !== userId), {
      type: NotificationType.FEEDBACK_CREATED,
      title: `项目「${project.title}」收到新的${TYPE_TEXT[dto.type]}`,
      content: `${user.name} 提交：${dto.title}`,
      link: `/projects/${projectId}?tab=feedback`,
    });

    return this.getById(feedback.id);
  }

  /**
   * 分页查询反馈列表
   * @param user 当前登录用户
   * @param query 查询条件
   */
  async list(user: AuthUser, query: ListFeedbackQueryDto) {
    const where: Prisma.FeedbackWhereInput = {};
    if (query.status) {
      where.status = query.status;
    }
    if (query.type) {
      where.type = query.type;
    }
    if (query.keyword) {
      where.OR = [
        { title: { contains: query.keyword, mode: 'insensitive' } },
        { content: { contains: query.keyword, mode: 'insensitive' } },
      ];
    }

    if (query.scope === 'mine') {
      where.userId = user.id;
    } else if (query.scope === 'assigned') {
      // 我需要处理的：我是负责人或项目成员的反馈
      where.project = {
        OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.feedback.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, avatarUrl: true } },
          project: { select: { id: true, title: true, repoUrl: true } },
          _count: { select: { comments: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.feedback.count({ where }),
    ]);
    return buildPaginated(items, total, query);
  }

  /**
   * 查询某个项目的反馈列表
   * @param projectId 项目主键
   * @param query 分页参数
   */
  async listByProject(projectId: string, query: PaginationQueryDto) {
    const where: Prisma.FeedbackWhereInput = { projectId };
    const [items, total] = await Promise.all([
      this.prisma.feedback.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, avatarUrl: true } },
          _count: { select: { comments: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.feedback.count({ where }),
    ]);
    return buildPaginated(items, total, query);
  }

  /**
   * 查询反馈详情（含评论）
   * @param id 反馈主键
   */
  async getById(id: string) {
    const feedback = await this.prisma.feedback.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, department: true, avatarUrl: true } },
        project: { select: { id: true, title: true, repoUrl: true, ownerId: true } },
        comments: {
          include: { user: { select: { id: true, name: true, avatarUrl: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!feedback) {
      throw new NotFoundException('反馈不存在');
    }
    return feedback;
  }

  /**
   * 追加评论，并同步到 Gitea Issue
   * @param id 反馈主键
   * @param userId 评论人主键
   * @param dto 评论内容
   */
  async addComment(id: string, userId: string, dto: CreateFeedbackCommentDto) {
    const feedback = await this.getById(id);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    await this.prisma.feedbackComment.create({
      data: { feedbackId: id, userId, content: dto.content },
    });

    // 同步到 Issue 评论，让 Gitea 侧的开发者也能看到
    const project = await this.projects.getRepositoryInfo(feedback.projectId);
    if (project.repoOwner && project.repoName && feedback.issueNumber && this.gitea.isConfigured) {
      await this.gitea
        .createIssueComment(
          project.repoOwner,
          project.repoName,
          feedback.issueNumber,
          `**${user.name}**（来自需求协作平台）：\n\n${dto.content}`,
        )
        .catch((error: Error) => this.logger.warn(`同步 Issue 评论失败: ${error.message}`));
    }

    // 通知另外一方
    const targets = new Set<string>();
    if (feedback.userId !== userId) {
      targets.add(feedback.userId);
    }
    if (project.ownerId && project.ownerId !== userId) {
      targets.add(project.ownerId);
    }
    await this.notifications.createMany([...targets], {
      type: NotificationType.FEEDBACK_UPDATED,
      title: `反馈「${feedback.title}」有新回复`,
      content: `${user.name}：${dto.content.slice(0, 120)}`,
      link: `/projects/${feedback.projectId}?tab=feedback&feedbackId=${id}`,
    });

    return this.getById(id);
  }

  /**
   * 更新反馈状态；标记为已解决时同步关闭 Gitea Issue
   * @param id 反馈主键
   * @param actor 操作人
   * @param dto 目标状态与说明
   */
  async updateStatus(id: string, actor: AuthUser, dto: UpdateFeedbackStatusDto) {
    const feedback = await this.getById(id);
    const project = await this.projects.getRepositoryInfo(feedback.projectId);

    const isAdmin = actor.role === Role.ADMIN;
    const isOwner = project.ownerId === actor.id;
    const isReporter = feedback.userId === actor.id;
    if (!isAdmin && !isOwner && !isReporter) {
      throw new ForbiddenException('只有反馈提交人、项目负责人或管理员可以变更反馈状态');
    }

    await this.prisma.feedback.update({ where: { id }, data: { status: dto.status } });

    const shouldClose = dto.status === FeedbackStatus.RESOLVED || dto.status === FeedbackStatus.CLOSED;
    if (
      project.repoOwner &&
      project.repoName &&
      feedback.issueNumber &&
      this.gitea.isConfigured &&
      shouldClose
    ) {
      await this.gitea
        .closeIssue(
          project.repoOwner,
          project.repoName,
          feedback.issueNumber,
          dto.remark ? `**${actor.name}（来自需求协作平台）**：${dto.remark}` : undefined,
        )
        .catch((error: Error) => this.logger.warn(`关闭 Issue 失败: ${error.message}`));
    }

    // 通知反馈提交人状态变化
    if (feedback.userId !== actor.id) {
      await this.notifications.create({
        userId: feedback.userId,
        type: NotificationType.FEEDBACK_UPDATED,
        title: `反馈「${feedback.title}」状态已更新`,
        content: `状态已变更为 ${dto.status}。${dto.remark ?? ''}`,
        link: `/projects/${feedback.projectId}?tab=feedback&feedbackId=${id}`,
      });
    }

    return this.getById(id);
  }

  /** 反馈统计：按状态与类型聚合，用于项目看板 */
  async stats(projectId?: string) {
    const where: Prisma.FeedbackWhereInput = projectId ? { projectId } : {};
    const grouped = await this.prisma.feedback.groupBy({
      by: ['status', 'type'],
      where,
      _count: { _all: true },
    });
    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};
    for (const item of grouped) {
      byStatus[item.status] = (byStatus[item.status] ?? 0) + item._count._all;
      byType[item.type] = (byType[item.type] ?? 0) + item._count._all;
    }
    return { byStatus, byType };
  }

  /** 拼装同步到 Gitea 的 Issue 正文 */
  private buildIssueBody(dto: CreateFeedbackDto, reporterName: string): string {
    return [
      `> 由需求协作平台自动创建，提交人：${reporterName}`,
      '',
      `**反馈类型**：${TYPE_TEXT[dto.type]}`,
      '',
      '## 反馈内容',
      '',
      dto.content,
      '',
      '---',
      '请在平台或本 Issue 中回复处理进展；在平台中标记「已解决」会自动关闭本 Issue。',
    ].join('\n');
  }
}
