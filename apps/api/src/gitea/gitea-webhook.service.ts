/**
 * Gitea Webhook 处理服务
 * 作用：把仓库侧的 PR / Issue / CI 事件同步回平台数据，并触发相应通知
 */
import {
  CiCallbackPayload,
  GiteaIssueCommentEvent,
  GiteaIssueEvent,
  GiteaPullRequestEvent,
  GiteaPullRequestReviewEvent,
  GiteaPushEvent,
  GiteaReleaseEvent,
  GiteaStatusEvent,
  GiteaWorkflowRunEvent,
} from './dto/gitea-webhook.dto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Injectable, Logger } from '@nestjs/common';
import { FeedbackStatus, NotificationType, ProjectStatus } from '@prisma/client';

@Injectable()
export class GiteaWebhookService {
  private readonly logger = new Logger(GiteaWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ----------------------------------------------------------------
  // 事件分发
  // ----------------------------------------------------------------

  /**
   * 根据事件类型分发处理
   * @param event Gitea 事件名（X-Gitea-Event 请求头）
   * @param payload 事件载荷
   */
  async dispatch(event: string, payload: unknown): Promise<void> {
    switch (event) {
      case 'pull_request':
        await this.handlePullRequest(payload as GiteaPullRequestEvent);
        break;
      case 'pull_request_review_approved':
      case 'pull_request_review_rejected':
      case 'pull_request_review_comment':
      case 'pull_request_review':
        await this.handlePullRequestReview(payload as GiteaPullRequestReviewEvent);
        break;
      case 'push':
        await this.handlePush(payload as GiteaPushEvent);
        break;
      case 'issues':
        await this.handleIssue(payload as GiteaIssueEvent);
        break;
      case 'issue_comment':
        await this.handleIssueComment(payload as GiteaIssueCommentEvent);
        break;
      case 'status':
        await this.handleStatus(payload as GiteaStatusEvent);
        break;
      case 'workflow_run':
        await this.handleWorkflowRun(payload as GiteaWorkflowRunEvent);
        break;      case 'release':
        await this.handleRelease(payload as GiteaReleaseEvent);
        break;
      default:
        this.logger.debug(`忽略未处理的事件类型: ${event}`);
    }
  }

  // ----------------------------------------------------------------
  // Pull Request
  // ----------------------------------------------------------------

  /** 处理 PR 打开、更新、合并、关闭 */
  private async handlePullRequest(payload: GiteaPullRequestEvent): Promise<void> {
    const project = await this.resolveProject(payload.repository?.full_name);
    const pr = payload.pull_request;
    if (!project || !pr) {
      return;
    }

    const author = await this.prisma.user.findFirst({
      where: { giteaUsername: pr.user.login },
      select: { id: true },
    });

    const merged = Boolean(pr.merged) || payload.action === 'closed' && Boolean(pr.merged_at);
    const state = merged ? 'merged' : pr.state;

    await this.prisma.pullRequest.upsert({
      where: { projectId_number: { projectId: project.id, number: pr.number } },
      create: {
        projectId: project.id,
        number: pr.number,
        title: pr.title,
        state,
        merged,
        hasConflict: pr.mergeable === false,
        htmlUrl: pr.html_url,
        authorId: author?.id,
        authorName: pr.user.login,
        headBranch: pr.head.ref,
        baseBranch: pr.base.ref,
        mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
        closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
      },
      update: {
        title: pr.title,
        state,
        merged,
        hasConflict: pr.mergeable === false,
        mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
        closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
        authorId: author?.id,
      },
    });

    // 认领后一旦有 PR 提交，项目进入开发中
    if (project.status === ProjectStatus.CLAIMED && payload.action === 'opened') {
      await this.prisma.project.update({
        where: { id: project.id },
        data: { status: ProjectStatus.DEVELOPING },
      });
    }

    if (payload.action === 'opened') {
      await this.notifyProjectTeam(project.id, project.creatorId, {
        type: NotificationType.PR_UPDATED,
        title: `项目「${project.title}」有新的 Pull Request`,
        content: `${pr.user.login} 提交了 PR #${pr.number}：${pr.title}`,
        link: `/projects/${project.id}`,
      });
    }

    if (merged) {
      await this.notifyProjectTeam(project.id, project.creatorId, {
        type: NotificationType.PR_UPDATED,
        title: `项目「${project.title}」的 PR 已合并`,
        content: `PR #${pr.number}「${pr.title}」已合并到 ${pr.base.ref} 分支，可以验证效果了。`,
        link: `/projects/${project.id}`,
      });
    }
  }

  /** 处理代码评审事件，提醒 PR 作者 */
  private async handlePullRequestReview(payload: GiteaPullRequestReviewEvent): Promise<void> {
    const project = await this.resolveProject(payload.repository?.full_name);
    const pr = payload.pull_request;
    if (!project || !pr) {
      return;
    }

    const author = await this.prisma.user.findFirst({
      where: { giteaUsername: pr.user.login },
      select: { id: true },
    });
    if (!author) {
      return;
    }

    await this.notifications.create({
      userId: author.id,
      type: NotificationType.PR_UPDATED,
      title: `PR #${pr.number} 有新的评审意见`,
      content: `${payload.sender?.login ?? '评审人'} 对「${pr.title}」提交了评审（${payload.review?.state ?? '已评论'}）。`,
      link: `/projects/${project.id}`,
    });
  }

  // ----------------------------------------------------------------
  // Issue（平台反馈）
  // ----------------------------------------------------------------

  /** 处理 Issue 关闭，回写反馈状态 */
  private async handleIssue(payload: GiteaIssueEvent): Promise<void> {
    const project = await this.resolveProject(payload.repository?.full_name);
    const issue = payload.issue;
    if (!project || !issue) {
      return;
    }

    const feedback = await this.prisma.feedback.findFirst({
      where: { projectId: project.id, issueNumber: issue.number },
    });
    if (!feedback) {
      return;
    }

    if (issue.state === 'closed') {
      await this.prisma.feedback.update({
        where: { id: feedback.id },
        data: { status: FeedbackStatus.RESOLVED },
      });
      // 反馈被解决后通知提交人
      await this.notifications.create({
        userId: feedback.userId,
        type: NotificationType.FEEDBACK_CREATED,
        title: '你提交的反馈已解决',
        content: `项目「${project.title}」中你提交的反馈「${feedback.title}」已由开发人员处理完成。`,
        link: `/projects/${project.id}`,
      });
    } else if (payload.action === 'reopened' && feedback.status === FeedbackStatus.RESOLVED) {
      // 仅在 Issue 被显式重新打开时才回退状态，避免「打开」事件的延迟投递冲掉已解决状态
      await this.prisma.feedback.update({
        where: { id: feedback.id },
        data: { status: FeedbackStatus.OPEN },
      });
    }
  }

  /** 处理 Issue 评论同步 */
  private async handleIssueComment(payload: GiteaIssueCommentEvent): Promise<void> {
    if (payload.action !== 'created') {
      return;
    }
    const project = await this.resolveProject(payload.repository?.full_name);
    const issue = payload.issue;
    const comment = payload.comment;
    if (!project || !issue || !comment) {
      return;
    }

    const feedback = await this.prisma.feedback.findFirst({
      where: { projectId: project.id, issueNumber: issue.number },
    });
    if (!feedback) {
      return;
    }

    // 若评论来自平台用户，说明是平台内发起的，避免重复写入
    const author = await this.prisma.user.findFirst({
      where: { giteaUsername: comment.user.login },
      select: { id: true },
    });
    const duplicated = await this.prisma.feedbackComment.findFirst({
      where: { feedbackId: feedback.id, content: comment.body },
    });
    if (duplicated) {
      return;
    }

    if (author) {
      await this.prisma.feedbackComment.create({
        data: { feedbackId: feedback.id, userId: author.id, content: comment.body },
      });
    }

    // 通知反馈提交人与项目负责人
    const targets = [feedback.userId, project.ownerId].filter((id): id is string => Boolean(id));
    await this.notifications.createMany(targets, {
      type: NotificationType.FEEDBACK_CREATED,
      title: `反馈「${feedback.title}」有新回复`,
      content: `${comment.user.login}：${comment.body.slice(0, 120)}`,
      link: `/projects/${project.id}`,
    });
  }

  // ----------------------------------------------------------------
  // 推送事件
  // ----------------------------------------------------------------

  /**
   * 处理代码推送：把对应分支的 PR 标记为「流水线运行中」
   * @param payload push 事件载荷
   */
  private async handlePush(payload: GiteaPushEvent): Promise<void> {
    const branch = payload.ref?.replace('refs/heads/', '');
    if (!branch) {
      // 非分支推送（例如标签）无需处理
      return;
    }
    const project = await this.resolveProject(payload.repository?.full_name);
    if (!project) {
      return;
    }

    const pullRequests = await this.prisma.pullRequest.findMany({
      where: { projectId: project.id, headBranch: branch, merged: false },
      select: { id: true },
    });
    if (pullRequests.length === 0) {
      return;
    }
    await this.prisma.pullRequest.updateMany({
      where: { id: { in: pullRequests.map((item) => item.id) } },
      data: { ciStatus: 'pending' },
    });
  }

  // ----------------------------------------------------------------
  // CI 状态
  // ----------------------------------------------------------------

  /**
   * 接收仓库工作流主动上报的流水线结果
   * 说明：Gitea 1.22 的 Webhook 无法订阅流水线事件，故由 workflow 回调本接口
   * @param payload 上报内容
   */
  async reportCiStatus(payload: CiCallbackPayload): Promise<boolean> {
    if (!payload.repo || !payload.status) {
      return false;
    }
    const project = await this.resolveProject(payload.repo);
    if (!project) {
      return false;
    }
    const branch = payload.branch ?? '';
    const targets = await this.prisma.pullRequest.findMany({
      where: { projectId: project.id, merged: false, ...(branch ? { headBranch: branch } : {}) },
      select: { id: true, authorId: true },
    });
    if (targets.length === 0) {
      return true;
    }

    await this.prisma.pullRequest.updateMany({
      where: { id: { in: targets.map((item) => item.id) } },
      data: { ciStatus: payload.status },
    });

    // 流水线结束才通知，避免频繁打扰
    if (payload.status === 'success' || payload.status === 'failure') {
      const authorIds = targets
        .map((item) => item.authorId)
        .filter((id): id is string => Boolean(id));
      await this.notifications.createMany(authorIds, {
        type: NotificationType.CI_FINISHED,
        title: payload.status === 'success' ? 'CI 流水线执行成功' : 'CI 流水线执行失败',
        content: `项目「${project.title}」分支 ${branch || '默认分支'} 的流水线${
          payload.status === 'success' ? '已通过' : '未通过，请检查日志'
        }。${payload.runUrl ?? ''}`,
        link: `/projects/${project.id}`,
      });
    }

    this.logger.log(
      `流水线状态回调: ${payload.repo}#${branch || '-'} -> ${payload.status}（匹配 PR ${targets.length} 个）`,
    );
    return true;
  }

  /** 处理提交状态事件（状态检查） */
  private async handleStatus(payload: GiteaStatusEvent): Promise<void> {
    const branch = payload.branches?.[0]?.name;
    const status = this.mapCiStatus(payload.state);
    await this.applyCiStatus(payload.repository?.full_name, branch, status, payload.target_url);
  }

  /** 处理 Actions 流水线事件 */
  private async handleWorkflowRun(payload: GiteaWorkflowRunEvent): Promise<void> {
    const run = payload.workflow_run;
    if (!run) {
      return;
    }
    let status: 'pending' | 'success' | 'failure' | 'unknown' = 'pending';
    if (run.status === 'completed') {
      status = run.conclusion === 'success' ? 'success' : 'failure';
    }
    await this.applyCiStatus(payload.repository?.full_name, run.head_branch, status, run.html_url);
  }

  /**
   * 按分支定位 PR 并更新 CI 状态
   * @param repoFullName 仓库全名 org/repo
   * @param branch 分支名
   * @param status CI 状态
   * @param targetUrl 流水线地址
   */
  private async applyCiStatus(
    repoFullName: string | undefined,
    branch: string | undefined,
    status: 'pending' | 'success' | 'failure' | 'unknown',
    targetUrl?: string,
  ): Promise<void> {
    const project = await this.resolveProject(repoFullName);
    if (!project || !branch) {
      return;
    }

    const pullRequests = await this.prisma.pullRequest.findMany({
      where: { projectId: project.id, headBranch: branch, merged: false },
    });
    if (pullRequests.length === 0) {
      return;
    }

    await this.prisma.pullRequest.updateMany({
      where: { id: { in: pullRequests.map((item) => item.id) } },
      data: { ciStatus: status },
    });

    // 仅在流水线结束时通知，避免频繁打扰
    if (status === 'success' || status === 'failure') {
      const authorIds = pullRequests
        .map((item) => item.authorId)
        .filter((id): id is string => Boolean(id));
      await this.notifications.createMany(authorIds, {
        type: NotificationType.CI_FINISHED,
        title: status === 'success' ? 'CI 流水线执行成功' : 'CI 流水线执行失败',
        content: `项目「${project.title}」分支 ${branch} 的流水线${status === 'success' ? '已通过' : '未通过，请检查日志'}。${targetUrl ?? ''}`,
        link: `/projects/${project.id}`,
      });
    }
  }

  /** 处理发布事件，把项目标记为已发布 */
  private async handleRelease(payload: GiteaReleaseEvent): Promise<void> {
    if (payload.action !== 'published' && payload.action !== 'created') {
      return;
    }
    const project = await this.resolveProject(payload.repository?.full_name);
    if (!project || !payload.release) {
      return;
    }

    await this.prisma.project.update({
      where: { id: project.id },
      data: { status: ProjectStatus.RELEASED, releasedAt: new Date() },
    });

    await this.notifications.create({
      userId: project.creatorId,
      type: NotificationType.PR_UPDATED,
      title: `项目「${project.title}」已发布新版本`,
      content: `版本 ${payload.release.tag_name} 已发布，请前往验收。${payload.release.html_url}`,
      link: `/projects/${project.id}`,
    });
  }

  // ----------------------------------------------------------------
  // 内部工具
  // ----------------------------------------------------------------

  /**
   * 通过仓库全名定位平台项目
   * @param repoFullName 形如 org/repo-name
   */
  private async resolveProject(repoFullName: string | undefined) {
    if (!repoFullName) {
      return null;
    }
    const [repoOwner, repoName] = repoFullName.split('/');
    if (!repoOwner || !repoName) {
      return null;
    }
    return this.prisma.project.findFirst({
      where: { repoOwner, repoName },
      select: { id: true, title: true, creatorId: true, ownerId: true, status: true },
    });
  }

  /**
   * 通知项目相关成员（负责人 + 成员）
   * @param projectId 项目主键
   * @param creatorId 需求方主键
   * @param payload 通知内容
   */
  private async notifyProjectTeam(
    projectId: string,
    creatorId: string,
    payload: { type: NotificationType; title: string; content: string; link: string },
  ): Promise<void> {
    const members = await this.prisma.projectMember.findMany({
      where: { projectId },
      select: { userId: true },
    });
    const targets = [creatorId, ...members.map((item) => item.userId)];
    await this.notifications.createMany(targets, payload);
  }

  /** 把 Gitea 状态枚举映射为平台 CI 状态 */
  private mapCiStatus(state?: string): 'pending' | 'success' | 'failure' | 'unknown' {
    switch (state) {
      case 'pending':
        return 'pending';
      case 'success':
        return 'success';
      case 'failure':
      case 'error':
        return 'failure';
      default:
        return 'unknown';
    }
  }
}
