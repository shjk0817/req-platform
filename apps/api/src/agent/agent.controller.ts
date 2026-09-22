/**
 * Agent 聚合控制器
 * 作用：提供稳定的 CLI / MCP HTTP 契约，并用 scope 守卫隔离读写能力
 */
import { AgentService } from './agent.service';
import { Scopes } from '../common/decorators/scopes.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { CreateFeedbackCommentDto, CreateFeedbackDto, ListFeedbackQueryDto } from '../feedbacks/dto/feedbacks.dto';
import { ClaimProjectDto, CreateProjectDto, CreateProjectUpdateDto, ListProjectsQueryDto } from '../projects/dto/projects.dto';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Agent / CLI')
@ApiBearerAuth()
@Controller('agent')
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  /** 聚合当前用户的待办、通知和反馈 */
  @Get('me/work')
  @Scopes('read')
  @ApiOperation({ summary: '获取当前用户的 Agent 工作上下文' })
  getMyWork(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    return this.agent.getMyWork(user, query);
  }

  /** 查询需求池 */
  @Get('projects')
  @Scopes('read')
  @ApiOperation({ summary: '查询需求池' })
  listProjects(@CurrentUser() user: AuthUser, @Query() query: ListProjectsQueryDto) {
    return this.agent.listProjects(user, query);
  }

  /** 查询项目完整上下文 */
  @Get('projects/:id/context')
  @Scopes('read')
  @ApiOperation({ summary: '查询项目完整 Agent 上下文' })
  getProjectContext(@Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.agent.getProjectContext(id, query);
  }

  /** 查询项目 Git 元数据 */
  @Get('projects/:id/git')
  @Scopes('read', 'git:metadata')
  @ApiOperation({ summary: '查询项目 Git clone 地址与当前权限' })
  getProjectGit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.agent.getProjectGit(id, user);
  }

  /** 查询项目成果 */
  @Get('projects/:id/deliverables')
  @Scopes('read')
  @ApiOperation({ summary: '查询项目 README、教程与下载内容' })
  getDeliverables(@Param('id') id: string) {
    return this.agent.getDeliverables(id);
  }

  /** 查询全局反馈 */
  @Get('feedbacks')
  @Scopes('read')
  @ApiOperation({ summary: '查询当前用户相关反馈' })
  listFeedbacks(@CurrentUser() user: AuthUser, @Query() query: ListFeedbackQueryDto) {
    return this.agent.listFeedbacks(user, query);
  }

  /** 查询单条反馈详情 */
  @Get('feedbacks/:id')
  @Scopes('read')
  @ApiOperation({ summary: '查询反馈详情与评论' })
  getFeedback(@Param('id') id: string) {
    return this.agent.getFeedback(id);
  }

  /** 查询当前用户通知 */
  @Get('notifications')
  @Scopes('read')
  @ApiOperation({ summary: '查询当前用户通知' })
  listNotifications(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    return this.agent.listNotifications(user, query);
  }

  /** 发布需求 */
  @Post('projects')
  @Scopes('read', 'project:write')
  @ApiOperation({ summary: '通过 Agent 发布需求' })
  createProject(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateProjectDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.agent.createProject(user, dto, requestId);
  }

  /** 认领需求 */
  @Post('projects/:id/claim')
  @Scopes('read', 'project:write')
  @ApiOperation({ summary: '通过 Agent 认领需求' })
  claimProject(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ClaimProjectDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.agent.claimProject(user, id, dto, requestId);
  }

  /** 加入开发协作 */
  @Post('projects/:id/join')
  @Scopes('read', 'project:write')
  @ApiOperation({ summary: '通过 Agent 加入项目开发' })
  joinDevelopment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.agent.joinDevelopment(user, id, requestId);
  }

  /** 发布项目沟通或追加需求 */
  @Post('projects/:id/updates')
  @Scopes('read', 'project:write')
  @ApiOperation({ summary: '通过 Agent 发布项目沟通或追加需求' })
  postUpdate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateProjectUpdateDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.agent.postUpdate(user, id, dto, requestId);
  }

  /** 提交反馈 */
  @Post('projects/:id/feedbacks')
  @Scopes('read', 'feedback:write')
  @ApiOperation({ summary: '通过 Agent 提交反馈' })
  createFeedback(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateFeedbackDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.agent.createFeedback(user, id, dto, requestId);
  }

  /** 回复反馈 */
  @Post('feedbacks/:id/comments')
  @Scopes('read', 'feedback:write')
  @ApiOperation({ summary: '通过 Agent 回复反馈' })
  commentFeedback(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateFeedbackCommentDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.agent.commentFeedback(user, id, dto, requestId);
  }

  /** 兜底同步 PR */
  @Post('projects/:id/sync')
  @Scopes('read', 'project:write', 'git:metadata')
  @ApiOperation({ summary: '通过 Agent 同步项目 PR 记录' })
  syncProject(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.agent.syncProject(user, id, requestId);
  }
}
