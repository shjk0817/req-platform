/**
 * 项目（需求）服务
 * 作用：需求发布、需求池检索、认领（先到先得）、自动建仓、成员与状态管理
 */
import {
  AddMemberDto,
  AddRequesterDto,
  ClaimProjectDto,
  CreateProjectDto,
  ListProjectsQueryDto,
  UpdateProjectDto,
  UpdateProjectStatusDto,
} from './dto/projects.dto';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { buildPaginated } from '../common/dto/pagination.dto';
import { GiteaService } from '../gitea/gitea.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { calcProjectProgress } from '../common/utils/progress.util';
import { isAllowedAvatar, PROJECT_AVATAR_PRESETS } from '../common/constants/avatars';
import { buildRepoName } from '../common/utils/naming.util';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MemberRole, NotificationType, Prisma, ProjectStatus, Role } from '@prisma/client';

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
    include: { user: { select: { ...USER_BRIEF_SELECT, skills: true } } },
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
        avatar,
        expectedAt: dto.expectedAt ? new Date(dto.expectedAt) : null,
        creatorId,
        status: ProjectStatus.OPEN,
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

    // 通知具备相关能力标签的同事，提高认领率
    if (project.tags.length > 0) {
      const developers = await this.prisma.user.findMany({
        where: { status: 'ACTIVE', id: { not: creatorId }, skills: { hasSome: project.tags } },
        select: { id: true },
        take: 50,
      });
      await this.notifications.createMany(
        developers.map((item) => item.id),
        {
          type: NotificationType.PROJECT_CLAIMED,
          title: '有新的需求可能适合你',
          content: `需求「${project.title}」已发布，标签：${project.tags.join('、')}。欢迎认领。`,
          link: `/projects/${project.id}`,
        },
      );
    }

    this.logger.log(`新需求已发布: ${project.id} - ${project.title}`);
    return this.toDetail(withAttachments);
  }

  /**
   * 分页查询需求池
   * @param user 当前登录用户
   * @param query 查询条件（状态、标签、范围、关键字）
   */
  async list(user: AuthUser, query: ListProjectsQueryDto) {
    const where: Prisma.ProjectWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }
    if (query.tag) {
      where.tags = { has: query.tag };
    }
    if (query.keyword) {
      where.OR = [
        { title: { contains: query.keyword, mode: 'insensitive' } },
        { description: { contains: query.keyword, mode: 'insensitive' } },
      ];
    }

    switch (query.scope) {
      case 'mine':
        where.OR = [
          { ownerId: user.id },
          { members: { some: { userId: user.id } } },
        ];
        break;
      case 'created':
        where.creatorId = user.id;
        break;
      case 'unclaimed':
        where.status = ProjectStatus.OPEN;
        break;
      case 'developing':
        where.status = { in: [ProjectStatus.CLAIMED, ProjectStatus.DEVELOPING] };
        break;
      case 'requesting':
        // 我关注的：我作为共同需求人加入的需求
        where.requesters = { some: { userId: user.id } };
        break;
      default:
        break;
    }

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
  async getById(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: PROJECT_DETAIL_INCLUDE,
    });
    if (!project) {
      throw new NotFoundException('项目不存在');
    }
    const pullRequests = await this.prisma.pullRequest.findMany({
      where: { projectId: id },
      orderBy: { number: 'desc' },
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
      take: 20,
    });
    const mergedPullReqs = pullRequests.filter((item) => item.merged).length;
    return {
      ...this.toDetail(project, mergedPullReqs),
      pullRequests,
    };
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
    if (project.creatorId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException('只有需求方或管理员可以修改需求内容');
    }

    const updated = await this.prisma.project.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        acceptanceCriteria: dto.acceptanceCriteria,
        tags: dto.tags,
        avatar: dto.avatar === undefined ? undefined : this.normalizeAvatar(dto.avatar),
        expectedAt: dto.expectedAt ? new Date(dto.expectedAt) : undefined,
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
    if (project.creatorId === userId) {
      throw new ForbiddenException('不能认领自己提出的需求，请邀请其他同事认领');
    }

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
    const repository = await this.tryCreateRepository(project.title, project.id, project.description).catch(
      (error: Error) => {
        this.logger.warn(`自动建仓失败（可在项目页重试）: ${error.message}`);
        return null;
      },
    );

    const finalProject = await this.prisma.project.update({
      where: { id },
      data: repository
        ? { repoOwner: repository.repoOwner, repoName: repository.repoName, repoUrl: repository.repoUrl }
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
    });

    this.logger.log(`需求 ${id} 被 ${user.email} 认领（第 ${claims} 次认领记录）`);
    return this.toDetail(finalProject);
  }

  /**
   * 手动创建/修复项目仓库（负责人或管理员）
   * @param id 项目主键
   * @param user 当前登录用户
   */
  async ensureRepository(id: string, user: AuthUser) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new NotFoundException('项目不存在');
    }
    if (project.ownerId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException('只有项目负责人或管理员可以创建仓库');
    }
    if (project.repoUrl) {
      return { message: '仓库已存在', repoUrl: project.repoUrl };
    }

    const repository = await this.tryCreateRepository(project.title, project.id, project.description);
    if (!repository) {
      throw new BadRequestException('仓库创建失败，请检查 Gitea 服务与初始化脚本后重试');
    }

    const updated = await this.prisma.project.update({
      where: { id },
      data: { repoOwner: repository.repoOwner, repoName: repository.repoName, repoUrl: repository.repoUrl },
    });
    return { message: '仓库创建成功', repoUrl: updated.repoUrl, repoName: updated.repoName };
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
    if (!this.canManage(project, actor)) {
      throw new ForbiddenException('只有项目负责人、需求方或管理员可以添加协作者');
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
    if (!this.canManage(project, actor)) {
      throw new ForbiddenException('只有项目负责人、需求方或管理员可以移除协作者');
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

    const updated = await this.prisma.project.update({
      where: { id },
      data: {
        status: dto.status,
        releasedAt: dto.status === ProjectStatus.RELEASED ? new Date() : undefined,
      },
      include: PROJECT_DETAIL_INCLUDE,
    });

    await this.notifications.create({
      userId: project.creatorId,
      type: NotificationType.PROJECT_CLAIMED,
      title: `项目「${project.title}」状态已更新`,
      content: `项目状态已变更为 ${dto.status}，操作人：${actor.name}。`,
      link: `/projects/${id}`,
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
    if (!this.canManage(project, actor)) {
      throw new ForbiddenException('只有项目负责人、需求方或管理员可以同步仓库信息');
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
    const [owning, created, pendingFeedbacks, openPullRequests] = await Promise.all([
      this.prisma.project.findMany({
        where: { ownerId: userId, status: { in: [ProjectStatus.CLAIMED, ProjectStatus.DEVELOPING] } },
        select: { id: true, title: true, status: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      }),
      this.prisma.project.findMany({
        where: { creatorId: userId, status: { in: [ProjectStatus.OPEN, ProjectStatus.CLAIMED, ProjectStatus.DEVELOPING] } },
        select: { id: true, title: true, status: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      }),
      this.prisma.feedback.count({ where: { userId, status: { in: ['OPEN', 'PROCESSING'] } } }),
      this.prisma.pullRequest.count({ where: { authorId: userId, merged: false, state: 'open' } }),
    ]);
    return { owning, created, pendingFeedbacks, openPullRequests };
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
   */
  private async tryCreateRepository(
    title: string,
    projectId: string,
    description: string,
  ): Promise<{ repoOwner: string; repoName: string; repoUrl: string } | null> {
    if (!this.gitea.isConfigured) {
      this.logger.warn('Gitea 未配置，跳过自动建仓');
      return null;
    }

    const repoName = buildRepoName(title);
    const repoDescription = `[需求协作平台] ${title}\n\n${description.slice(0, 200)}`;

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
      repoUrl: created.html_url ?? `${this.gitea.publicRootUrl}/${this.gitea.org}/${repoName}`,
    };
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
      select: { id: true, title: true, repoOwner: true, repoName: true, repoUrl: true, ownerId: true },
    });
    if (!project) {
      throw new NotFoundException('项目不存在');
    }
    return project;
  }
}
