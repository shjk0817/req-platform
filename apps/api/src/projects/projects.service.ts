/**
 * 项目（需求）服务
 * 作用：需求发布、需求池检索、认领（先到先得）、自动建仓、成员与状态管理
 */
import {
  AddMemberDto,
  AddRequesterDto,
  ClaimProjectDto,
  CreateRepositoryDto,
  CreateProjectDto,
  CreateProjectUpdateDto,
  ListProjectsQueryDto,
  NudgeProjectDto,
  ReturnProjectDto,
  SubmitAcceptanceDto,
  UpdateProjectDto,
  UpdateProjectStatusDto,
} from './dto/projects.dto';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { buildPaginated, PaginationQueryDto } from '../common/dto/pagination.dto';
import { GiteaService } from '../gitea/gitea.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { calcProjectProgress } from '../common/utils/progress.util';
import { isAllowedAvatar, PROJECT_AVATAR_PRESETS } from '../common/constants/avatars';
import { buildRepoName, normalizeRepoName } from '../common/utils/naming.util';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  FeedbackStatus,
  MemberRole,
  NotificationType,
  Prisma,
  ProjectStatus,
  Role,
  UserStatus,
} from '@prisma/client';

/** 用户简要信息（含头像），需求方 / 负责方 / 成员 / 共同需求人统一使用 */
const USER_BRIEF_SELECT = {
  id: true,
  name: true,
  email: true,
  department: true,
  avatarUrl: true,
} satisfies Prisma.UserSelect;

/** 项目详情查询时统一使用的关联字段 */
const PROJECT_DETAIL_INCLUDE = {
  creator: { select: USER_BRIEF_SELECT },
  owner: { select: { ...USER_BRIEF_SELECT, giteaUsername: true } },
  members: {
    include: { user: { select: USER_BRIEF_SELECT } },
    orderBy: { createdAt: 'asc' as const },
  },
  requesters: {
    include: { user: { select: USER_BRIEF_SELECT } },
    orderBy: { createdAt: 'asc' as const },
  },
  claims: {
    include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    orderBy: { createdAt: 'desc' as const },
    take: 10,
  },
  attachments: { orderBy: { createdAt: 'asc' as const } },
  acceptanceItems: { orderBy: { sort: 'asc' as const } },
  updates: {
    include: { author: { select: USER_BRIEF_SELECT } },
    orderBy: { createdAt: 'asc' as const },
  },
  _count: { select: { feedbacks: true, pullReqs: true } },
} satisfies Prisma.ProjectInclude;

/** 列表查询时使用的关联字段（比详情更精简） */
const PROJECT_LIST_INCLUDE = {
  creator: { select: USER_BRIEF_SELECT },
  owner: { select: USER_BRIEF_SELECT },
  requesters: {
    include: { user: { select: USER_BRIEF_SELECT } },
    orderBy: { createdAt: 'asc' as const },
  },
  _count: {
    select: { feedbacks: true, pullReqs: true, members: true, attachments: true },
  },
} satisfies Prisma.ProjectInclude;

/** 建仓时传入的可读命名字段 */
type RepositoryNamingInput = {
  repoName?: string;
  repoDisplayName?: string;
};

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gitea: GiteaService,
    private readonly notifications: NotificationsService,
    private readonly uploads: UploadsService,
  ) {}

  // ----------------------------------------------------------------
  // 需求发布与查询
  // ----------------------------------------------------------------

  /**
   * 发布新需求，进入需求池等待认领
   * @param creatorId 需求方主键
   * @param dto 需求内容
   */
  async create(creatorId: string, dto: CreateProjectDto) {
    const avatar = this.normalizeAvatar(dto.avatar);
    const project = await this.prisma.project.create({
      data: {
        title: dto.title,
        description: dto.description,
        acceptanceCriteria: dto.acceptanceCriteria,
        tags: dto.tags ?? [],
        requiredSkills: dto.requiredSkills ?? [],
        avatar,
        expectedAt: dto.expectedAt ? new Date(dto.expectedAt) : null,
        creatorId,
        status: ProjectStatus.OPEN,
        acceptanceItems: dto.acceptanceItems?.length
          ? {
              create: dto.acceptanceItems
                .map((content, sort) => content.trim())
                .filter(Boolean)
                .map((content, sort) => ({ content, sort })),
            }
          : undefined,
      },
      include: PROJECT_DETAIL_INCLUDE,
    });

    // 把发布前上传的图片与附件挂到需求上
    const attachmentIds = [...(dto.imageIds ?? []), ...(dto.attachmentIds ?? [])];
    await this.uploads.attachToProject(attachmentIds, project.id, creatorId);
    const withAttachments = attachmentIds.length
      ? await this.prisma.project.findUniqueOrThrow({
          where: { id: project.id },
          include: PROJECT_DETAIL_INCLUDE,
        })
      : project;

    this.logger.log(`新需求已发布: ${project.id} - ${project.title}`);
    return this.toDetail(withAttachments);
  }

  /**
   * 分页查询需求池
   * @param user 当前登录用户
   * @param query 查询条件（状态、标签、范围、关键字）
   */
  async list(user: AuthUser, query: ListProjectsQueryDto) {
    const and: Prisma.ProjectWhereInput[] = [];

    if (query.status) {
      and.push({ status: query.status });
    }
    if (query.tag) {
      and.push({ tags: { has: query.tag } });
    }
    if (query.keyword) {
      and.push({
        OR: [
          { title: { contains: query.keyword, mode: 'insensitive' } },
          { description: { contains: query.keyword, mode: 'insensitive' } },
          { acceptanceCriteria: { contains: query.keyword, mode: 'insensitive' } },
        ],
      });
    }

    switch (query.scope) {
      case 'mine':
        and.push({
          OR: [
          { ownerId: user.id },
          { members: { some: { userId: user.id } } },
          ],
        });
        break;
      case 'created':
        and.push({ creatorId: user.id });
        break;
      case 'unclaimed':
        and.push({ status: ProjectStatus.OPEN });
        break;
      case 'developing':
        and.push({ status: { in: [ProjectStatus.CLAIMED, ProjectStatus.DEVELOPING] } });
        break;
      case 'requesting':
        // 我关注的：我作为共同需求人加入的需求
        and.push({ requesters: { some: { userId: user.id } } });
        break;
      default:
        break;
    }
    if (query.overdue) {
      and.push({
        expectedAt: { lt: new Date() },
        status: { notIn: [ProjectStatus.CLOSED] },
        acceptedAt: null,
      });
    }
    const where: Prisma.ProjectWhereInput = and.length > 0 ? { AND: and } : {};

    const [items, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        include: PROJECT_LIST_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.project.count({ where }),
    ]);

    // 查询本页项目已合并的 PR 数，用于细化「开发中」阶段的进度
    const mergedCounts = await this.countMergedPullRequests(items.map((item) => item.id));

    return buildPaginated(
      items.map((item) => ({
        ...item,
        // 列表页以卡片形式提示「带图片 / 附件」，这里直接拍平数量字段
        attachmentCount: item._count.attachments,
        overdue: Boolean(item.expectedAt && item.expectedAt < new Date() && !item.acceptedAt && item.status !== ProjectStatus.CLOSED),
        overdueDays: item.expectedAt
          ? Math.max(0, Math.floor((Date.now() - item.expectedAt.getTime()) / (24 * 60 * 60 * 1000)))
          : 0,
        progress: calcProjectProgress(item.status, {
          pullReqs: item._count.pullReqs,
          mergedPullReqs: mergedCounts.get(item.id) ?? 0,
        }),
      })),
      total,
      query,
    );
  }

  /**
   * 批量统计各项目已合并的 PR 数量
   * @param projectIds 项目主键集合
   */
  private async countMergedPullRequests(projectIds: string[]): Promise<Map<string, number>> {
    if (projectIds.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.pullRequest.groupBy({
      by: ['projectId'],
      where: { projectId: { in: projectIds }, merged: true },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.projectId, row._count._all]));
  }


  /**
   * 查询项目详情
   * @param id 项目主键
   */
  async getById(id: string, query?: PaginationQueryDto) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: PROJECT_DETAIL_INCLUDE,
    });
    if (!project) {
      throw new NotFoundException('项目不存在');
    }
    const [pullRequests, pullRequestTotal, mergedPullReqs, feedbackEvents] = await Promise.all([
      this.prisma.pullRequest.findMany({
        where: { projectId: id },
        orderBy: { number: 'desc' },
        include: { author: { select: { id: true, name: true, avatarUrl: true } } },
        skip: query?.skip ?? 0,
        take: query?.pageSize ?? 20,
      }),
      this.prisma.pullRequest.count({ where: { projectId: id } }),
      this.prisma.pullRequest.count({ where: { projectId: id, merged: true } }),
      this.prisma.feedback.findMany({
        where: { projectId: id },
        select: { id: true, title: true, createdAt: true, status: true },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    ]);
    const timeline = [
      ...(project.claims ?? []).map((claim) => ({
        at: claim.createdAt,
        type: 'claim',
        text: `${claim.user.name} 接手了需求`,
        detail: claim.remark,
      })),
      ...feedbackEvents.map((feedback) => ({
        at: feedback.createdAt,
        type: 'feedback',
        text: `收到反馈：${feedback.title}`,
        detail: `当前状态：${feedback.status}`,
      })),
      ...pullRequests.map((pullRequest) => ({
        at: pullRequest.createdAt,
        type: 'change',
        text: `收到一份修改：${pullRequest.title}`,
        detail: pullRequest.merged ? '这份修改已合并' : '等待确认',
      })),
      ...(project.updates ?? []).map((update) => ({
        at: update.createdAt,
        type: update.kind === 'ADDITIONAL_REQUIREMENT' ? 'update-requirement' : 'update',
        text: `${update.author.name}${update.kind === 'ADDITIONAL_REQUIREMENT' ? '追加了一项需求' : '留下了沟通记录'}`,
        detail: update.content,
      })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());
    return {
      ...this.toDetail(project, mergedPullReqs),
      pullRequests,
      pullRequestPage: {
        page: query?.page ?? 1,
        pageSize: query?.pageSize ?? 20,
        total: pullRequestTotal,
        totalPages: Math.ceil(pullRequestTotal / (query?.pageSize ?? 20)),
      },
      timeline,
    };
  }

  /**
   * 查询项目沟通与追加需求记录
   * @param id 项目主键
   */
  async listUpdates(id: string) {
    const exists = await this.prisma.project.findUnique({ where: { id }, select: { id: true } });
    if (!exists) {
      throw new NotFoundException('项目不存在');
    }
    return this.prisma.projectUpdate.findMany({
      where: { projectId: id },
      include: { author: { select: USER_BRIEF_SELECT } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * 新增项目沟通或追加需求，保留原始需求正文不变
   * @param id 项目主键
   * @param actor 当前操作人
   * @param dto 更新内容
   */
  async createUpdate(id: string, actor: AuthUser, dto: CreateProjectUpdateDto) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        creatorId: true,
        ownerId: true,
        requesters: { select: { userId: true } },
        members: { select: { userId: true } },
      },
    });
    if (!project) {
      throw new NotFoundException('项目不存在');
    }

    const canWrite =
      actor.role === Role.ADMIN ||
      project.creatorId === actor.id ||
      project.ownerId === actor.id ||
      project.requesters.some((item) => item.userId === actor.id) ||
      project.members.some((item) => item.userId === actor.id);
    if (!canWrite) {
      throw new ForbiddenException('只有需求方、共同需求人、负责人或协作者可以发布项目记录');
    }

    const content = dto.content.trim();
    if (!content) {
      throw new BadRequestException('记录内容不能为空');
    }
    const update = await this.prisma.projectUpdate.create({
      data: { projectId: id, authorId: actor.id, kind: dto.kind, content },
      include: { author: { select: USER_BRIEF_SELECT } },
    });

    const recipients =
      dto.kind === 'ADDITIONAL_REQUIREMENT'
        ? [project.ownerId]
        : actor.id === project.ownerId
          ? [project.creatorId]
          : [project.ownerId, project.creatorId];
    const recipientIds = recipients.filter((recipientId): recipientId is string => Boolean(recipientId && recipientId !== actor.id));
    if (recipientIds.length > 0) {
      await this.notifications.createMany(recipientIds, {
        type: NotificationType.PROJECT_UPDATE_CREATED,
        title: dto.kind === 'ADDITIONAL_REQUIREMENT' ? '需求有新的追加内容' : '项目有新的沟通记录',
        content: `${actor.name} 在需求「${project.title}」中${dto.kind === 'ADDITIONAL_REQUIREMENT' ? '追加了内容' : '留下了沟通'}：${content.slice(0, 160)}`,
        link: `/projects/${id}?tab=updates`,
        sendMail: dto.kind === 'ADDITIONAL_REQUIREMENT',
      });
    }
    return update;
  }

  /**
   * 聚合项目成果
   * 作用：把 README、教程、成果展示地址与 Release 下载统一成普通用户能看懂的页面数据
   * @param id 项目主键
   */
  async getDeliverables(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: { attachments: { orderBy: { createdAt: 'asc' } } },
    });
    if (!project) {
      throw new NotFoundException('项目不存在');
    }

    const images = project.attachments
      .filter((item) => item.kind === 'IMAGE')
      .map((item) => this.uploads.toDto(item));
    const base = {
      project: {
        id: project.id,
        title: project.title,
        repoDisplayName: project.repoDisplayName,
        repoOwner: project.repoOwner,
        repoName: project.repoName,
        repoUrl: project.repoUrl,
        demoUrl: project.demoUrl,
      },
      showcase: { demoUrl: project.demoUrl, images },
      readme: null as { path: string; content: string; htmlUrl?: string } | null,
      tutorial: null as { path: string; content: string; htmlUrl?: string } | null,
      downloads: [] as Array<{
        id: number;
        tag: string;
        name: string;
        htmlUrl: string;
        publishedAt: string | null;
        assets: Array<{ id: number; name: string; size: number; downloadUrl: string }>;
      }>,
    };

    if (!project.repoOwner || !project.repoName || !this.gitea.isConfigured) {
      return base;
    }

    const [readme, tutorial, downloads] = await Promise.all([
      this.gitea.getRepositoryReadme(project.repoOwner, project.repoName).catch((error: Error) => {
        this.logger.warn(`读取 README 失败: ${error.message}`);
        return null;
      }),
      this.gitea.getRepositoryTutorial(project.repoOwner, project.repoName).catch((error: Error) => {
        this.logger.warn(`读取使用教程失败: ${error.message}`);
        return null;
      }),
      this.gitea.listReleaseDownloads(project.repoOwner, project.repoName).catch((error: Error) => {
        this.logger.warn(`读取 Release 失败: ${error.message}`);
        return [];
      }),
    ]);
    return { ...base, readme, tutorial, downloads };
  }

  /**
   * 修改需求内容（需求方或管理员）
   * @param id 项目主键
   * @param user 当前登录用户
   * @param dto 待修改字段
   */
  async update(id: string, user: AuthUser, dto: UpdateProjectDto) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new NotFoundException('项目不存在');
    }
    const isOwnerOnly = project.ownerId === user.id && project.creatorId !== user.id && user.role !== Role.ADMIN;
    const onlyUpdatingDemoUrl = Object.keys(dto).every((key) => key === 'demoUrl');
    if (project.creatorId !== user.id && user.role !== Role.ADMIN && !(isOwnerOnly && onlyUpdatingDemoUrl)) {
      throw new ForbiddenException('只有需求方、负责人或管理员可以修改需求；负责人只能补充成果展示地址');
    }
    if (project.repoName && dto.title !== undefined && dto.title !== project.title) {
      throw new BadRequestException('项目已经创建代码库，不能修改需求标题；可以修改描述和验收内容');
    }

    const updated = await this.prisma.project.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        acceptanceCriteria: dto.acceptanceCriteria,
        tags: dto.tags,
        requiredSkills: dto.requiredSkills,
        avatar: dto.avatar === undefined ? undefined : this.normalizeAvatar(dto.avatar),
        expectedAt: dto.expectedAt ? new Date(dto.expectedAt) : undefined,
        demoUrl: dto.demoUrl === undefined ? undefined : dto.demoUrl.trim() || null,
        acceptanceItems: dto.acceptanceItems
          ? {
              deleteMany: {},
              create: dto.acceptanceItems
                .map((content) => content.trim())
                .filter(Boolean)
                .map((content, sort) => ({ content, sort })),
            }
          : undefined,
      },
      include: PROJECT_DETAIL_INCLUDE,
    });
    return this.toDetail(updated);
  }

  // ----------------------------------------------------------------
  // 认领
  // ----------------------------------------------------------------

  /**
   * 认领需求（先到先得）
   * 通过条件更新实现乐观锁，避免两人同时认领同一个需求
   * @param id 项目主键
   * @param userId 认领人主键
   * @param dto 认领留言
   */
  async claim(id: string, userId: string, dto: ClaimProjectDto) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: { creator: { select: { id: true, name: true, email: true } } },
    });
    if (!project) {
      throw new NotFoundException('项目不存在');
    }
    this.validateRepoName(dto.repoName);

    // 原子更新：只有仍处于 OPEN 状态时才能认领成功
    const updated = await this.prisma.project.updateMany({
      where: { id, status: ProjectStatus.OPEN },
      data: {
        ownerId: userId,
        status: ProjectStatus.CLAIMED,
        claimedAt: new Date(),
      },
    });
    if (updated.count === 0) {
      throw new ConflictException('手慢了，该需求刚刚已被其他同事认领');
    }

    await this.prisma.$transaction([
      this.prisma.projectClaim.create({ data: { projectId: id, userId, remark: dto.remark } }),
      this.prisma.projectMember.upsert({
        where: { projectId_userId: { projectId: id, userId } },
        create: { projectId: id, userId, role: MemberRole.OWNER },
        update: { role: MemberRole.OWNER },
      }),
    ]);

    // 认领后立即在 Gitea 创建仓库；失败不阻塞认领，可由负责人或管理员重试
    const claims = await this.prisma.projectClaim.count({ where: { projectId: id } });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const repository = await this.tryCreateRepository(project.title, project.id, project.description, dto).catch(
      (error: Error) => {
        this.logger.warn(`自动建仓失败（可在项目页重试）: ${error.message}`);
        if (dto.repoName?.trim()) {
          throw new BadRequestException(`指定的仓库名无法创建：${error.message}`);
        }
        return null;
      },
    );

    const finalProject = await this.prisma.project.update({
      where: { id },
      data: repository
        ? {
            repoOwner: repository.repoOwner,
            repoName: repository.repoName,
            repoDisplayName: repository.repoDisplayName,
            repoUrl: repository.repoUrl,
          }
        : {},
      include: PROJECT_DETAIL_INCLUDE,
    });

    await this.notifications.create({
      userId: project.creatorId,
      type: NotificationType.PROJECT_CLAIMED,
      title: '你的需求已被认领',
      content: `${user.name} 认领了你的需求「${project.title}」${
        dto.remark ? `，留言：${dto.remark}` : ''
      }。后续可通过项目页跟进进度。`,
      link: `/projects/${id}`,
      sendMail: true,
    });

    this.logger.log(`需求 ${id} 被 ${user.email} 认领（第 ${claims} 次认领记录）`);
    return this.toDetail(finalProject);
  }

  /**
   * 手动创建/修复项目仓库（负责人或管理员）
   * @param id 项目主键
   * @param user 当前登录用户
   */
  async ensureRepository(id: string, user: AuthUser, dto: CreateRepositoryDto = {}) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new NotFoundException('项目不存在');
    }
    if (project.ownerId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException('只有项目负责人或管理员可以创建仓库');
    }
    if (project.repoUrl) {
      return {
        message: '仓库已存在',
        repoUrl: project.repoUrl,
        repoName: project.repoName,
        repoDisplayName: project.repoDisplayName ?? project.title,
      };
    }

    this.validateRepoName(dto.repoName);
    const repository = await this.tryCreateRepository(project.title, project.id, project.description, dto);
    if (!repository) {
      throw new BadRequestException('仓库创建失败，请检查 Gitea 服务与初始化脚本后重试');
    }

    const updated = await this.prisma.project.update({
      where: { id },
      data: {
        repoOwner: repository.repoOwner,
        repoName: repository.repoName,
        repoDisplayName: repository.repoDisplayName,
        repoUrl: repository.repoUrl,
      },
    });
    return {
      message: '仓库创建成功',
      repoUrl: updated.repoUrl,
      repoName: updated.repoName,
      repoDisplayName: updated.repoDisplayName,
    };
  }

  // ----------------------------------------------------------------
  // 成员与状态
  // ----------------------------------------------------------------

  /**
   * 添加项目协作者，并同步 Gitea 仓库权限
   * @param id 项目主键
   * @param actor 操作人
   * @param dto 待加入的用户
   */
  async addMember(id: string, actor: AuthUser, dto: AddMemberDto) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new NotFoundException('项目不存在');
    }
    if (project.ownerId !== actor.id && actor.role !== Role.ADMIN) {
      throw new ForbiddenException('只有项目负责人或管理员可以添加协作者');
    }

    const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    await this.prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: id, userId: dto.userId } },
      create: { projectId: id, userId: dto.userId, role: MemberRole.COLLABORATOR },
      update: {},
    });

    // 同步 Gitea 仓库写权限
    if (project.repoOwner && project.repoName && user.giteaUsername) {
      await this.gitea
        .addCollaborator(project.repoOwner, project.repoName, user.giteaUsername, 'write')
        .catch((error: Error) => this.logger.warn(`同步 Gitea 协作者失败: ${error.message}`));
    }

    await this.notifications.create({
      userId: dto.userId,
      type: NotificationType.PROJECT_MEMBER_ADDED,
      title: '你被加入了一个项目',
      content: `${actor.name} 邀请你参与项目「${project.title}」，欢迎一起协作开发。`,
      link: `/projects/${id}`,
    });

    return this.getById(id);
  }

  /**
   * 当前用户自助加入项目开发，成为协作者并同步代码库写权限
   * @param id 项目主键
   * @param actor 当前登录用户
   */
  async joinMember(id: string, actor: AuthUser) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new NotFoundException('项目不存在');
    }
    if (!project.ownerId) {
      throw new BadRequestException('请先由同事认领需求，再加入开发协作');
    }
    if (project.status === ProjectStatus.CLOSED) {
      throw new BadRequestException('已结束的项目不能加入开发');
    }
    if (project.ownerId === actor.id) {
      return this.getById(id);
    }

    const existing = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: id, userId: actor.id } },
    });
    if (existing) {
      return this.getById(id);
    }

    await this.prisma.projectMember.create({
      data: { projectId: id, userId: actor.id, role: MemberRole.COLLABORATOR },
    });

    if (project.repoOwner && project.repoName && actor.giteaUsername) {
      await this.gitea
        .addCollaborator(project.repoOwner, project.repoName, actor.giteaUsername, 'write')
        .catch((error: Error) => this.logger.warn(`同步自助协作者失败: ${error.message}`));
    }

    const recipients = [project.ownerId, project.creatorId].filter(
      (recipientId): recipientId is string => Boolean(recipientId && recipientId !== actor.id),
    );
    if (recipients.length > 0) {
      await this.notifications.createMany([...new Set(recipients)], {
        type: NotificationType.PROJECT_MEMBER_ADDED,
        title: '有同事加入项目开发',
        content: `${actor.name} 已加入需求「${project.title}」的开发协作。`,
        link: `/projects/${id}`,
      });
    }

    return this.getById(id);
  }

  /**
   * 移除项目协作者
   * @param id 项目主键
   * @param actor 操作人
   * @param memberId 待移除的用户主键
   */
  async removeMember(id: string, actor: AuthUser, memberId: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new NotFoundException('项目不存在');
    }
    if (project.ownerId !== actor.id && actor.role !== Role.ADMIN) {
      throw new ForbiddenException('只有项目负责人或管理员可以移除协作者');
    }
    if (project.ownerId === memberId) {
      throw new BadRequestException('不能移除项目负责人');
    }

    await this.prisma.projectMember.deleteMany({ where: { projectId: id, userId: memberId } });

    const user = await this.prisma.user.findUnique({ where: { id: memberId } });
    if (project.repoOwner && project.repoName && user?.giteaUsername) {
      await this.gitea
        .removeCollaborator(project.repoOwner, project.repoName, user.giteaUsername)
        .catch((error: Error) => this.logger.warn(`移除 Gitea 协作者失败: ${error.message}`));
    }

    return this.getById(id);
  }

  // ----------------------------------------------------------------
  // 共同需求人
  // ----------------------------------------------------------------

  /**
   * 添加共同需求人
   * - 平台管理员：可以指定任意同事加入
   * - 其他同事：只能把自己加入（「我也需要」自助登记）
   * 说明：共同需求人代表「还有谁也需要这个需求」，属于需求范围的信息，
   *      因此只有平台管理员能替别人登记，避免每个人的名单被别人随意改动
   * @param id 项目主键
   * @param actor 操作人
   * @param dto 目标用户，缺省表示把自己加入
   */
  async addRequester(id: string, actor: AuthUser, dto: AddRequesterDto) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new NotFoundException('项目不存在');
    }

    const targetId = dto.userId ?? actor.id;
    if (targetId !== actor.id && actor.role !== Role.ADMIN) {
      throw new ForbiddenException('只有管理员可以添加其他共同需求人，其他同事只能把自己加入');
    }
    if (targetId === project.creatorId) {
      throw new BadRequestException('需求方本人无需重复添加');
    }

    const target = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!target) {
      throw new NotFoundException('用户不存在');
    }

    await this.prisma.projectRequester.upsert({
      where: { projectId_userId: { projectId: id, userId: targetId } },
      create: { projectId: id, userId: targetId },
      update: {},
    });

    // 通知需求方，便于了解还有谁需要这个需求
    await this.notifications.create({
      userId: project.creatorId,
      type: NotificationType.PROJECT_REQUESTER_ADDED,
      title: '有同事也需要这个需求',
      content: `${target.name} 已加入需求「${project.title}」的共同需求人，可以一起补充细节。`,
      link: `/projects/${id}`,
    });

    return this.getById(id);
  }

  /**
   * 移除共同需求人
   * - 平台管理员：可以移除任意同事
   * - 其他同事：只能移除自己（退出「我也需要」）
   * @param id 项目主键
   * @param actor 操作人
   * @param userId 待移除的用户主键
   */
  async removeRequester(id: string, actor: AuthUser, userId: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new NotFoundException('项目不存在');
    }
    if (userId !== actor.id && actor.role !== Role.ADMIN) {
      throw new ForbiddenException('只有管理员可以移除其他共同需求人，其他同事只能退出自己');
    }

    const removed = await this.prisma.projectRequester.deleteMany({
      where: { projectId: id, userId },
    });
    if (removed.count === 0) {
      throw new NotFoundException('该同事不在共同需求人列表中');
    }

    return this.getById(id);
  }

  /**
   * 交还已认领的需求，保留仓库与认领历史，避免误点后无法恢复。
   * @param id 项目主键
   * @param actor 当前负责人或管理员
   * @param dto 交还说明
   */
  async returnToPool(id: string, actor: AuthUser, dto: ReturnProjectDto) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new NotFoundException('项目不存在');
    }
    if (project.ownerId !== actor.id && actor.role !== Role.ADMIN) {
      throw new ForbiddenException('只有当前负责人或管理员可以把需求交还需求池');
    }
    if (
      !project.ownerId ||
      (project.status !== ProjectStatus.CLAIMED && project.status !== ProjectStatus.DEVELOPING)
    ) {
      throw new BadRequestException('只有已有人接手但尚未试用的需求可以交还');
    }
    const latestClaim = await this.prisma.projectClaim.findFirst({
      where: { projectId: id, userId: project.ownerId, returnedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    const withinUndoWindow = latestClaim
      ? Date.now() - latestClaim.createdAt.getTime() <= 10 * 60 * 1000
      : false;
    if (!withinUndoWindow && !dto.remark?.trim()) {
      throw new BadRequestException('认领已超过 10 分钟，请填写交还原因');
    }

    const owner = await this.prisma.user.findUnique({
      where: { id: project.ownerId },
      select: { id: true, name: true, giteaUsername: true },
    });
    await this.prisma.$transaction([
      this.prisma.project.update({
        where: { id },
        data: { ownerId: null, status: ProjectStatus.OPEN, claimedAt: null },
      }),
      ...(latestClaim
        ? [
            this.prisma.projectClaim.update({
              where: { id: latestClaim.id },
              data: { returnedAt: new Date(), returnRemark: dto.remark?.trim() || '误认领，交还需求池' },
            }),
          ]
        : []),
      this.prisma.projectMember.deleteMany({ where: { projectId: id, userId: project.ownerId } }),
    ]);
    if (project.repoOwner && project.repoName && owner?.giteaUsername) {
      await this.gitea
        .removeCollaborator(project.repoOwner, project.repoName, owner.giteaUsername)
        .catch((error: Error) => this.logger.warn(`收回仓库权限失败: ${error.message}`));
    }
    await this.notifications.create({
      userId: project.creatorId,
      type: NotificationType.PROJECT_STATUS_CHANGED,
      title: '需求已交还需求池',
      content: `${owner?.name ?? '原负责人'} 已把「${project.title}」交还需求池，其他同事可以重新接手。`,
      link: `/projects/${id}`,
    });
    return this.getById(id);
  }

  /**
   * 需求方提交试用验收结果；失败条目会自动生成反馈并退回开发中。
   * @param id 项目主键
   * @param actor 需求方或管理员
   * @param dto 条目结果
   */
  async submitAcceptance(id: string, actor: AuthUser, dto: SubmitAcceptanceDto) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: { acceptanceItems: { orderBy: { sort: 'asc' } } },
    });
    if (!project) {
      throw new NotFoundException('项目不存在');
    }
    if (project.creatorId !== actor.id && actor.role !== Role.ADMIN) {
      throw new ForbiddenException('只有需求方或管理员可以提交试用结果');
    }
    if (project.status !== ProjectStatus.RELEASED) {
      throw new BadRequestException('项目还没有进入试用阶段');
    }

    const resultMap = new Map(dto.items.map((item) => [item.id, item]));
    const failures = project.acceptanceItems
      .map((item) => ({ item, result: resultMap.get(item.id) }))
      .filter(({ result }) => result?.result === 'FAILED');
    const passedAll =
      project.acceptanceItems.length > 0
        ? project.acceptanceItems.every((item) => resultMap.get(item.id)?.result === 'PASSED')
        : Boolean(dto.remark?.trim());
    if (
      project.acceptanceItems.length > 0 &&
      project.acceptanceItems.some((item) => !['PASSED', 'FAILED'].includes(resultMap.get(item.id)?.result ?? ''))
    ) {
      throw new BadRequestException('请逐条选择「可以」或「这里不行」');
    }
    if (!passedAll && failures.length === 0 && project.acceptanceItems.length > 0) {
      throw new BadRequestException('请逐条选择「可以」或「这里不行」');
    }
    if (!passedAll && !dto.remark?.trim() && failures.length === 0) {
      throw new BadRequestException('请填写试用结果');
    }

    let generatedFeedbackId: string | null = null;
    await this.prisma.$transaction(async (tx) => {
      for (const item of project.acceptanceItems) {
        const result = resultMap.get(item.id);
        if (result) {
          await tx.acceptanceItem.update({
            where: { id: item.id },
            data: { result: result.result, note: result.note?.trim() || null },
          });
        }
      }
      await tx.project.update({
        where: { id },
        data: {
          status: passedAll ? ProjectStatus.RELEASED : ProjectStatus.DEVELOPING,
          acceptedAt: passedAll ? new Date() : null,
        },
      });
      if (!passedAll) {
        const failedText = failures
          .map(({ item, result }) => `- ${item.content}${result?.note ? `：${result.note}` : ''}`)
          .join('\n');
        const feedback = await tx.feedback.create({
          data: {
            projectId: id,
            userId: actor.id,
            type: 'BUG',
            title: '试用时发现问题',
            content: [failedText, dto.remark?.trim()].filter(Boolean).join('\n\n'),
          },
        });
        generatedFeedbackId = feedback.id;
      }
    });

    // 验收打回生成的反馈同样同步到项目代码库，开发者在任一入口都能看到。
    if (
      generatedFeedbackId &&
      project.repoOwner &&
      project.repoName &&
      this.gitea.isConfigured
    ) {
      try {
        const feedback = await this.prisma.feedback.findUniqueOrThrow({ where: { id: generatedFeedbackId } });
        const issue = await this.gitea.createIssue(project.repoOwner, project.repoName, {
          title: `[试用反馈] ${feedback.title}`,
          body: feedback.content,
          labels: ['bug'],
        });
        if (issue) {
          await this.prisma.feedback.update({
            where: { id: generatedFeedbackId },
            data: { issueNumber: issue.number, issueUrl: issue.html_url },
          });
        }
      } catch (error) {
        this.logger.warn(`同步试用反馈失败: ${(error as Error).message}`);
      }
    }

    if (project.ownerId) {
      await this.notifications.create({
        userId: project.ownerId,
        type: passedAll ? NotificationType.PROJECT_STATUS_CHANGED : NotificationType.PROJECT_OVERDUE,
        title: passedAll ? '需求方已确认可以使用' : '需求方试用后发现问题',
        content: passedAll
          ? `需求「${project.title}」已通过试用。`
          : `需求「${project.title}」有验收条目未通过，请查看反馈并继续修改。`,
        link: `/projects/${id}?tab=${passedAll ? 'detail' : 'feedback'}`,
        sendMail: !passedAll,
      });
    }
    return this.getById(id);
  }

  /**
   * 催办负责人或提醒管理员关注尚未接手的需求，七天内只发送一次。
   * @param id 项目主键
   * @param actor 需求方或共同需求人
   * @param dto 催办说明
   */
  async nudge(id: string, actor: AuthUser, dto: NudgeProjectDto) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: { requesters: { select: { userId: true } } },
    });
    if (!project) {
      throw new NotFoundException('项目不存在');
    }
    const isRequester = project.requesters.some((item) => item.userId === actor.id);
    if (project.creatorId !== actor.id && !isRequester && actor.role !== Role.ADMIN) {
      throw new ForbiddenException('只有需求方或共同需求人可以催办');
    }
    const isOverdue =
      Boolean(project.expectedAt && project.expectedAt < new Date() && !project.acceptedAt) &&
      project.status !== ProjectStatus.CLOSED;
    if (project.status !== ProjectStatus.OPEN && !isOverdue) {
      throw new BadRequestException('只有等待接手或已经逾期的需求可以催办');
    }
    const recent = await this.prisma.notification.findFirst({
      where: {
        type: NotificationType.PROJECT_NUDGED,
        link: `/projects/${id}`,
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
    });
    if (recent) {
      return { sent: false, message: '最近 7 天已经提醒过，请再等等' };
    }
    const recipients = project.ownerId
      ? [project.ownerId]
      : (await this.prisma.user.findMany({ where: { role: Role.ADMIN, status: 'ACTIVE' }, select: { id: true } })).map(
          (user) => user.id,
        );
    await this.notifications.createMany(recipients, {
      type: NotificationType.PROJECT_NUDGED,
      title: project.ownerId ? '有人在等你的进展' : '有需求等待同事接手',
      content: dto.remark?.trim() || `需求「${project.title}」有人在等后续进展。`,
      link: `/projects/${id}`,
      sendMail: false,
    });
    return { sent: true, message: '已提醒相关同事' };
  }

  /**
   * 更新项目状态（负责人、需求方或管理员）
   * @param id 项目主键
   * @param actor 操作人
   * @param dto 目标状态
   */
  async updateStatus(id: string, actor: AuthUser, dto: UpdateProjectStatusDto) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new NotFoundException('项目不存在');
    }
    if (!this.canManage(project, actor)) {
      throw new ForbiddenException('只有项目负责人、需求方或管理员可以变更项目状态');
    }
    if (
      dto.status === ProjectStatus.OPEN &&
      !(project.status === ProjectStatus.CLOSED && actor.role === Role.ADMIN)
    ) {
      throw new BadRequestException('请使用页面上的「我来做」或「交还需求池」完成这个操作');
    }
    if (dto.status === ProjectStatus.CLAIMED) {
      throw new BadRequestException('请使用页面上的「我来做」完成认领');
    }
    if (project.status === ProjectStatus.CLOSED && dto.status !== ProjectStatus.OPEN && actor.role !== Role.ADMIN) {
      throw new ForbiddenException('已结束的需求只能由管理员重新开启');
    }
    if (
      dto.status === ProjectStatus.RELEASED &&
      actor.role !== Role.ADMIN &&
      project.ownerId !== actor.id
    ) {
      throw new ForbiddenException('只有当前负责人或管理员可以请求需求方试用');
    }
    if (
      dto.status === ProjectStatus.DEVELOPING &&
      project.status !== ProjectStatus.CLAIMED &&
      project.status !== ProjectStatus.DEVELOPING
    ) {
      throw new BadRequestException('需求必须先有人接手，才能进入正在做');
    }
    if (
      dto.status === ProjectStatus.RELEASED &&
      project.status !== ProjectStatus.CLAIMED &&
      project.status !== ProjectStatus.DEVELOPING
    ) {
      throw new BadRequestException('需求必须先有人接手并开始修改，才能请需求方试用');
    }
    if (dto.status === ProjectStatus.CLOSED && !dto.remark?.trim() && !project.acceptedAt) {
      throw new BadRequestException('结束需求前请填写原因，或先完成需求方试用');
    }

    const updated = await this.prisma.project.update({
      where: { id },
      data: {
        status: dto.status,
        ownerId: dto.status === ProjectStatus.OPEN ? null : undefined,
        claimedAt: dto.status === ProjectStatus.OPEN ? null : undefined,
        acceptedAt: dto.status === ProjectStatus.OPEN ? null : undefined,
        releasedAt: dto.status === ProjectStatus.RELEASED ? new Date() : undefined,
      },
      include: PROJECT_DETAIL_INCLUDE,
    });

    await this.notifications.create({
      userId: project.creatorId,
      type: NotificationType.PROJECT_STATUS_CHANGED,
      title: `项目「${project.title}」状态已更新`,
      content: `${actor.name} 将项目状态更新为 ${dto.status}。${dto.remark ?? ''}`,
      link: `/projects/${id}`,
      sendMail: dto.status === ProjectStatus.RELEASED,
    });

    return this.toDetail(updated);
  }

  /**
   * 手动同步 Gitea 仓库中的 Pull Request（Webhook 丢失时的兜底）
   * @param id 项目主键
   * @param actor 操作人
   */
  async syncPullRequests(id: string, actor: AuthUser) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new NotFoundException('项目不存在');
    }
    if (project.ownerId !== actor.id && actor.role !== Role.ADMIN) {
      throw new ForbiddenException('只有项目负责人或平台管理员可以同步仓库信息');
    }
    if (!project.repoOwner || !project.repoName) {
      throw new BadRequestException('该项目尚未创建仓库');
    }

    const list = await this.gitea.listPullRequests(project.repoOwner, project.repoName);
    if (!list) {
      return { message: '未获取到 Pull Request，请检查 Gitea 连接', synced: 0 };
    }

    for (const pr of list) {
      const merged = Boolean(pr.merged) || Boolean(pr.merged_at);
      const author = await this.prisma.user.findFirst({
        where: { giteaUsername: pr.user?.login },
        select: { id: true },
      });
      await this.prisma.pullRequest.upsert({
        where: { projectId_number: { projectId: id, number: pr.number } },
        create: {
          projectId: id,
          number: pr.number,
          title: pr.title,
          state: merged ? 'merged' : pr.state,
          merged,
          hasConflict: pr.mergeable === false,
          htmlUrl: pr.html_url,
          authorId: author?.id,
          authorName: pr.user?.login ?? '未知',
          headBranch: pr.head?.ref,
          baseBranch: pr.base?.ref,
          mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
          closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
        },
        update: {
          title: pr.title,
          state: merged ? 'merged' : pr.state,
          merged,
          hasConflict: pr.mergeable === false,
          mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
          closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
        },
      });
    }

    return { message: '同步完成', synced: list.length };
  }

  // ----------------------------------------------------------------
  // 统计
  // ----------------------------------------------------------------

  /** 平台首页统计数据 */
  async stats() {
    const [total, open, claimed, developing, released, feedbackOpen, users] = await Promise.all([
      this.prisma.project.count(),
      this.prisma.project.count({ where: { status: ProjectStatus.OPEN } }),
      this.prisma.project.count({ where: { status: ProjectStatus.CLAIMED } }),
      this.prisma.project.count({ where: { status: ProjectStatus.DEVELOPING } }),
      this.prisma.project.count({ where: { status: ProjectStatus.RELEASED } }),
      this.prisma.feedback.count({ where: { status: { in: ['OPEN', 'PROCESSING'] } } }),
      this.prisma.user.count({ where: { status: 'ACTIVE' } }),
    ]);
    return { total, open, claimed, developing, released, feedbackOpen, users };
  }

  /**
   * 查询与当前用户相关的待办：我负责的开发中项目 + 我提的需求被反馈的问题
   * @param userId 用户主键
   */
  async myTodos(userId: string) {
    const [user, owning, created, pendingFeedbacks, openPullRequests, pendingReview] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
      this.prisma.project.findMany({
        where: { ownerId: userId, status: { in: [ProjectStatus.CLAIMED, ProjectStatus.DEVELOPING] } },
        select: { id: true, title: true, status: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      }),
      this.prisma.project.findMany({
        where: {
          creatorId: userId,
          status: { in: [ProjectStatus.OPEN, ProjectStatus.CLAIMED, ProjectStatus.DEVELOPING, ProjectStatus.RELEASED] },
        },
        select: { id: true, title: true, status: true, acceptedAt: true, createdAt: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      }),
      this.prisma.feedback.count({
        where: {
          status: { in: ['OPEN', 'PROCESSING'] },
          project: { OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
        },
      }),
      this.prisma.pullRequest.count({ where: { authorId: userId, merged: false, state: 'open' } }),
      this.prisma.user.count({ where: { status: UserStatus.PENDING } }),
    ]);
    let nextAction: {
      title: string;
      reason: string;
      href: string;
      primaryLabel: string;
    };
    if (user?.role === Role.ADMIN && pendingReview > 0) {
      nextAction = {
        title: `有 ${pendingReview} 位同事在等开通`,
        reason: '通过审核后，他们才能登录并提交或接手需求。',
        href: '/admin/users?status=PENDING',
        primaryLabel: '去处理审核',
      };
    } else {
      const awaitingAcceptance = created.find(
        (item) => item.status === ProjectStatus.RELEASED && !item.acceptedAt,
      );
      const pendingFeedback = await this.prisma.feedback.findFirst({
        where: {
          project: { ownerId: userId },
          status: { in: [FeedbackStatus.OPEN, FeedbackStatus.PROCESSING] },
          createdAt: { lt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
        },
        select: { projectId: true },
        orderBy: { createdAt: 'asc' },
      });
      const staleCreated = created.find(
        (item) =>
          item.status === ProjectStatus.OPEN &&
          Date.now() - item.createdAt.getTime() > 7 * 24 * 60 * 60 * 1000,
      );
      if (awaitingAcceptance) {
        nextAction = {
          title: `请试用「${awaitingAcceptance.title}」`,
          reason: '负责人已经完成一版修改，现在需要你按验收清单试用。',
          href: `/projects/${awaitingAcceptance.id}?tab=acceptance`,
          primaryLabel: '开始试用',
        };
      } else if (pendingFeedback) {
        nextAction = {
          title: '有一条反馈等你回复',
          reason: '尽快回复能让需求方知道下一步怎么做。',
          href: `/projects/${pendingFeedback.projectId}?tab=feedback`,
          primaryLabel: '去回复',
        };
      } else if (owning.length > 0) {
        nextAction = {
          title: `继续推进「${owning[0].title}」`,
          reason: '打开项目查看下一步：提交修改、查看自动检查，或请需求方试用。',
          href: `/projects/${owning[0].id}`,
          primaryLabel: '继续推进',
        };
      } else if (staleCreated) {
        nextAction = {
          title: `「${staleCreated.title}」还没人接手`,
          reason: '可以补充说明，或先看看需求池里有没有相似需求。',
          href: `/projects/${staleCreated.id}`,
          primaryLabel: '补充需求',
        };
      } else {
        nextAction = {
          title: '看看有没有适合你的需求',
          reason: '你可以接手一条需求，也可以只点「我也想用」表达需要。',
          href: '/projects?scope=unclaimed',
          primaryLabel: '看看需求',
        };
      }
    }
    return { owning, created, pendingFeedbacks, openPullRequests, nextAction };
  }

  // ----------------------------------------------------------------
  // 内部工具
  // ----------------------------------------------------------------

  /** 判断当前用户是否有项目管理权限 */
  private canManage(
    project: { creatorId: string; ownerId: string | null },
    actor: AuthUser,
  ): boolean {
    return (
      actor.role === Role.ADMIN || actor.id === project.ownerId || actor.id === project.creatorId
    );
  }

  /**
   * 校验并规整任务头像取值
   * @param avatar 前端传入的头像标识
   */
  private normalizeAvatar(avatar?: string | null): string | null {
    if (!avatar) {
      return null;
    }
    if (!isAllowedAvatar(avatar, PROJECT_AVATAR_PRESETS)) {
      throw new BadRequestException('任务头像不在可选范围内');
    }
    return avatar;
  }

  /**
   * 把数据库记录整理成对外的需求详情结构
   * 作用：统一补充完成进度，并把附件按「图片 / 文件」分组，前端无需再自行过滤
   * @param project 带详情关联的项目记录
   * @param mergedPullReqs 已合并的 PR 数（用于细化开发中进度）
   */
  private toDetail(
    project: Prisma.ProjectGetPayload<{ include: typeof PROJECT_DETAIL_INCLUDE }>,
    mergedPullReqs = 0,
  ) {
    const { attachments = [], ...rest } = project;
    return {
      ...rest,
      images: attachments
        .filter((item) => item.kind === 'IMAGE')
        .map((item) => this.uploads.toDto(item)),
      files: attachments
        .filter((item) => item.kind === 'FILE')
        .map((item) => this.uploads.toDto(item)),
      attachmentCount: attachments.length,
      overdue: Boolean(
        project.expectedAt &&
          project.expectedAt < new Date() &&
          !project.acceptedAt &&
          project.status !== ProjectStatus.CLOSED,
      ),
      overdueDays: project.expectedAt
        ? Math.max(0, Math.floor((Date.now() - project.expectedAt.getTime()) / (24 * 60 * 60 * 1000)))
        : 0,
      progress: calcProjectProgress(project.status, {
        pullReqs: project._count.pullReqs,
        mergedPullReqs,
      }),
    };
  }

  /**
   * 创建仓库并完成协作者授权与 Webhook 配置
   * @param title 项目标题（用于生成仓库名）
   * @param projectId 项目主键
   * @param description 仓库描述
   * @param naming 用户填写的仓库名与中文别名
   */
  private async tryCreateRepository(
    title: string,
    projectId: string,
    description: string,
    naming: Pick<RepositoryNamingInput, 'repoName' | 'repoDisplayName'> = {},
  ): Promise<{ repoOwner: string; repoName: string; repoDisplayName: string; repoUrl: string } | null> {
    if (!this.gitea.isConfigured) {
      this.logger.warn('Gitea 未配置，跳过自动建仓');
      return null;
    }

    const repoName = normalizeRepoName(naming.repoName) ?? buildRepoName(title);
    const repoDisplayName = naming.repoDisplayName?.trim() || title;
    const repoDescription = `[需求协作平台] ${repoDisplayName}\n\n${description.slice(0, 200)}`;

    // 优先基于模板仓库生成，模板缺失时退化为空仓库
    let created: { full_name: string; html_url: string; clone_url: string; default_branch?: string } | null =
      await this.gitea.generateRepoFromTemplate({
        templateOwner: this.gitea.org,
        templateRepo: 'repo-template',
        owner: this.gitea.org,
        name: repoName,
        description: repoDescription,
      });
    if (!created) {
      this.logger.warn('模板仓库不可用，改为创建空仓库');
      created = await this.gitea.createOrgRepo({ name: repoName, description: repoDescription });
    }
    if (!created) {
      return null;
    }

    // 为仓库配置事件回写
    await this.gitea
      .ensureWebhook(this.gitea.org, repoName)
      .catch((error: Error) => this.logger.warn(`配置 Webhook 失败: ${error.message}`));

    // 为流水线写入回调地址与令牌，保证 CI 结果能回写平台
    await this.gitea
      .configureCiReporting(this.gitea.org, repoName)
      .catch((error: Error) => this.logger.warn(`配置流水线回调失败: ${error.message}`));

    // 项目相关成员统一授予写权限
    const members = await this.prisma.projectMember.findMany({
      where: { projectId },
      include: { user: { select: { giteaUsername: true } } },
    });
    for (const member of members) {
      if (member.user.giteaUsername) {
        await this.gitea
          .addCollaborator(this.gitea.org, repoName, member.user.giteaUsername, 'write')
          .catch((error: Error) => this.logger.warn(`授权协作者失败: ${error.message}`));
      }
    }

    return {
      repoOwner: this.gitea.org,
      repoName,
      repoDisplayName,
      repoUrl: created.html_url ?? `${this.gitea.publicRootUrl}/${this.gitea.org}/${repoName}`,
    };
  }

  /**
   * 在认领或建仓前校验手动仓库名，避免认领成功后才发现输入不可用
   * @param repoName 用户填写的仓库名
   */
  private validateRepoName(repoName?: string | null): void {
    try {
      normalizeRepoName(repoName);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  /** 当前用户是否为项目成员（供反馈模块校验） */
  async assertMember(projectId: string, userId: string): Promise<void> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException('项目不存在');
    }
    if (project.creatorId === userId || project.ownerId === userId) {
      return;
    }
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!member) {
      throw new ForbiddenException('你不是该项目成员');
    }
  }

  /** 读取项目仓库信息（供反馈模块同步 Issue） */
  async getRepositoryInfo(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        title: true,
        repoOwner: true,
        repoName: true,
        repoDisplayName: true,
        repoUrl: true,
        demoUrl: true,
        ownerId: true,
      },
    });
    if (!project) {
      throw new NotFoundException('项目不存在');
    }
    return project;
  }
}
