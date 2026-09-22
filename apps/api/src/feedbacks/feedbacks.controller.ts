/**
 * 反馈控制器
 * 作用：提供反馈提交、查询、评论与状态流转接口
 */
import {
  CreateFeedbackCommentDto,
  CreateFeedbackDto,
  ListFeedbackQueryDto,
  UpdateFeedbackStatusDto,
} from './dto/feedbacks.dto';
import { FeedbacksService } from './feedbacks.service';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

/** 挂在项目下的反馈接口 */
@ApiTags('反馈')
@ApiBearerAuth()
@Controller('projects/:projectId/feedbacks')
export class ProjectFeedbacksController {
  constructor(private readonly feedbacksService: FeedbacksService) {}

  /** 在指定项目下提交反馈 */
  @Post()
  @ApiOperation({ summary: '提交反馈（自动同步为仓库 Issue）' })
  create(
    @Param('projectId') projectId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateFeedbackDto,
  ) {
    return this.feedbacksService.create(projectId, userId, dto);
  }

  /** 查询指定项目的反馈列表 */
  @Get()
  @ApiOperation({ summary: '查询指定项目的反馈列表' })
  list(@Param('projectId') projectId: string, @Query() query: PaginationQueryDto) {
    return this.feedbacksService.listByProject(projectId, query);
  }

  /** 查询指定项目的反馈统计 */
  @Get('stats')
  @ApiOperation({ summary: '查询指定项目的反馈统计' })
  stats(@Param('projectId') projectId: string) {
    return this.feedbacksService.stats(projectId);
  }
}

/** 全局反馈接口 */
@ApiTags('反馈')
@ApiBearerAuth()
@Controller('feedbacks')
export class FeedbacksController {
  constructor(private readonly feedbacksService: FeedbacksService) {}

  /** 聚合查询反馈（我提交的 / 我需要处理的） */
  @Get()
  @ApiOperation({ summary: '分页查询反馈（支持 mine / assigned 范围）' })
  list(@CurrentUser() user: AuthUser, @Query() query: ListFeedbackQueryDto) {
    return this.feedbacksService.list(user, query);
  }

  /** 全局反馈统计 */
  @Get('stats')
  @ApiOperation({ summary: '全局反馈统计' })
  stats() {
    return this.feedbacksService.stats();
  }

  /** 反馈详情 */
  @Get(':id')
  @ApiOperation({ summary: '查询反馈详情（含讨论记录）' })
  getById(@Param('id') id: string) {
    return this.feedbacksService.getById(id);
  }

  /** 追加评论 */
  @Post(':id/comments')
  @ApiOperation({ summary: '追加评论（自动同步到仓库 Issue）' })
  addComment(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateFeedbackCommentDto,
  ) {
    return this.feedbacksService.addComment(id, userId, dto);
  }

  /** 更新反馈状态 */
  @Patch(':id/status')
  @ApiOperation({ summary: '更新反馈状态（标记已解决会自动关闭 Issue）' })
  updateStatus(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateFeedbackStatusDto,
  ) {
    return this.feedbacksService.updateStatus(id, user, dto);
  }
}
