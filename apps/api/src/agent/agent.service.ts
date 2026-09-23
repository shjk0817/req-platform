/**
 * Agent 聚合服务
 * 作用：为 CLI / MCP 提供稳定、粗粒度的机器接口，业务规则全部复用现有领域服务
 */
import { AgentAuditService } from './agent-audit.service';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { CreateFeedbackCommentDto, CreateFeedbackDto, ListFeedbackQueryDto } from '../feedbacks/dto/feedbacks.dto';
import { FeedbacksService } from '../feedbacks/feedbacks.service';
import { CreateProjectDto, ClaimProjectDto, CreateProjectUpdateDto, ListProjectsQueryDto } from '../projects/dto/projects.dto';
import { ProjectsService } from '../projects/projects.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { Injectable } from '@nestjs/common';

@Injectable()
export class AgentService {
  constructor(
    private readonly projects: ProjectsService,
    private readonly feedbacks: FeedbacksService,
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AgentAuditService,
  ) {}

  /** 返回版本化能力声明，供 CLI / MCP 启动时探测 */
  getCapabilities() {
    return {
      apiVersion: 'v1',
      serverVersion: '0.1.0',
      capabilities: {
        workContext: true,
        projectContext: true,
        projectWrites: true,
        feedbackWrites: true,
        gitMetadata: true,
        audit: true,
      },
      scopes: ['read', 'project:write', 'feedback:write', 'git:metadata'],
      confirmation: ['mcp_elicitation', 'aim_approve'],
    };
  }

  /** 汇总当前用户待办、未读通知和待处理反馈 */
  async getMyWork(user: AuthUser, query: PaginationQueryDto) {
    const [todos, notifications, unread, feedbacks] = await Promise.all([
      this.projects.myTodos(user.id),
      this.notifications.listMine(user.id, query),
      this.notifications.countUnread(user.id),
      this.feedbacks.list(
        user,
        Object.assign(new ListFeedbackQueryDto(), query, { scope: 'assigned' }),
      ),
    ]);
    return { todos, notifications, unread, feedbacks };
  }

  /** 查询需求池 */
  async listProjects(user: AuthUser, query: ListProjectsQueryDto) {
    return this.projects.list(user, query);
  }

  /** 获取单个项目的完整 Agent 上下文 */
  async getProjectContext(projectId: string, query: PaginationQueryDto) {
    const [project, updates, feedbacks] = await Promise.all([
      this.projects.getById(projectId, query),
      this.projects.listUpdates(projectId),
      this.feedbacks.listByProject(
        projectId,
        Object.assign(new PaginationQueryDto(), query, { pageSize: Math.min(query.pageSize, 50) }),
      ),
    ]);
    return { project, updates, feedbacks };
  }

  /** 获取项目 Git 元数据与当前用户的有效权限 */
  async getProjectGit(projectId: string, user: AuthUser) {
    const project = await this.projects.getRepositoryInfo(projectId);
    const membership = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: user.id } },
      select: { role: true },
    });
    const rootUrl = (this.config.get<string>('gitea.rootUrl') ?? '').replace(/\/$/, '');
    const root = new URL(rootUrl);
    const sshPort = this.config.get<number>('gitea.sshPort') ?? 2222;
    const canWrite = Boolean(
      user.role === 'ADMIN' ||
        project.ownerId === user.id ||
        membership?.role === 'OWNER' ||
        membership?.role === 'COLLABORATOR',
    );
    return {
      projectId,
      repoOwner: project.repoOwner,
      repoName: project.repoName,
      repoDisplayName: project.repoDisplayName,
      repoUrl: project.repoUrl,
      defaultBranch: 'main',
      httpCloneUrl:
        project.repoOwner && project.repoName ? `${rootUrl}/${project.repoOwner}/${project.repoName}.git` : null,
      sshCloneUrl:
        project.repoOwner && project.repoName
          ? `ssh://git@${root.hostname}:${sshPort}/${project.repoOwner}/${project.repoName}.git`
          : null,
      giteaUsername: user.giteaUsername,
      permission: canWrite ? 'write' : 'read',
      canWrite,
    };
  }

  /** 发布需求并记录 Agent 审计 */
  async createProject(user: AuthUser, dto: CreateProjectDto, requestId?: string) {
    const result = await this.projects.create(user.id, dto);
    await this.audit.record(user, 'create_project', 'project', result.id, requestId, dto);
    return result;
  }

  /** 认领需求并记录 Agent 审计 */
  async claimProject(user: AuthUser, projectId: string, dto: ClaimProjectDto, requestId?: string) {
    const result = await this.projects.claim(projectId, user.id, dto);
    await this.audit.record(user, 'claim_project', 'project', projectId, requestId, dto);
    return result;
  }

  /** 加入项目开发并记录 Agent 审计 */
  async joinDevelopment(user: AuthUser, projectId: string, requestId?: string) {
    const result = await this.projects.joinMember(projectId, user);
    await this.audit.record(user, 'join_development', 'project', projectId, requestId);
    return result;
  }

  /** 发布沟通或追加需求 */
  async postUpdate(user: AuthUser, projectId: string, dto: CreateProjectUpdateDto, requestId?: string) {
    const result = await this.projects.createUpdate(projectId, user, dto);
    await this.audit.record(user, 'post_project_update', 'project', projectId, requestId, dto);
    return result;
  }

  /** 提交反馈 */
  async createFeedback(user: AuthUser, projectId: string, dto: CreateFeedbackDto, requestId?: string) {
    const result = await this.feedbacks.create(projectId, user.id, dto);
    await this.audit.record(user, 'create_feedback', 'feedback', result.id, requestId, dto);
    return result;
  }

  /** 回复反馈 */
  async commentFeedback(user: AuthUser, feedbackId: string, dto: CreateFeedbackCommentDto, requestId?: string) {
    const result = await this.feedbacks.addComment(feedbackId, user.id, dto);
    await this.audit.record(user, 'comment_feedback', 'feedback', feedbackId, requestId, dto);
    return result;
  }

  /** 手动同步项目 PR */
  async syncProject(user: AuthUser, projectId: string, requestId?: string) {
    const result = await this.projects.syncPullRequests(projectId, user);
    await this.audit.record(user, 'sync_project', 'project', projectId, requestId);
    return result;
  }

  /** 查询全局反馈 */
  async listFeedbacks(user: AuthUser, query: ListFeedbackQueryDto) {
    return this.feedbacks.list(user, query);
  }

  /** 查询单条反馈详情 */
  async getFeedback(feedbackId: string) {
    return this.feedbacks.getById(feedbackId);
  }

  /** 查询当前用户通知 */
  async listNotifications(user: AuthUser, query: PaginationQueryDto) {
    return this.notifications.listMine(user.id, query);
  }

  /** 查询项目成果 */
  async getDeliverables(projectId: string) {
    return this.projects.getDeliverables(projectId);
  }
}
