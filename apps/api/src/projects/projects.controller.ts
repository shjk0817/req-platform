/**
 * 项目（需求）控制器
 * 作用：暴露需求发布、需求池查询、认领、成员管理与状态流转接口
 */
import {
  AddMemberDto,
  AddRequesterDto,
  ClaimProjectDto,
  CreateProjectDto,
  CreateProjectUpdateDto,
  CreateRepositoryDto,
  ListProjectsQueryDto,
  NudgeProjectDto,
  ReturnProjectDto,
  SubmitAcceptanceDto,
  UpdateProjectDto,
  UpdateProjectStatusDto,
} from './dto/projects.dto';
import { ProjectsService } from './projects.service';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('项目 / 需求')
@ApiBearerAuth()
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  /** 发布需求 */
  @Post()
  @ApiOperation({ summary: '发布需求，进入需求池等待认领' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateProjectDto) {
    return this.projectsService.create(userId, dto);
  }

  /** 需求池列表 */
  @Get()
  @ApiOperation({ summary: '分页查询需求池' })
  list(@CurrentUser() user: AuthUser, @Query() query: ListProjectsQueryDto) {
    return this.projectsService.list(user, query);
  }

  /** 首页统计数据 */
  @Get('stats')
  @ApiOperation({ summary: '首页统计数据' })
  stats() {
    return this.projectsService.stats();
  }

  /** 我的待办 */
  @Get('todos')
  @ApiOperation({ summary: '我的待办：负责的项目、提出的需求与待处理反馈' })
  myTodos(@CurrentUser('id') userId: string) {
    return this.projectsService.myTodos(userId);
  }

  /** 项目沟通与追加需求 */
  @Get(':id/updates')
  @ApiOperation({ summary: '查询项目沟通与追加需求记录' })
  listUpdates(@Param('id') id: string) {
    return this.projectsService.listUpdates(id);
  }

  /** 新增项目沟通或追加需求 */
  @Post(':id/updates')
  @ApiOperation({ summary: '新增项目沟通或追加需求' })
  createUpdate(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateProjectUpdateDto,
  ) {
    return this.projectsService.createUpdate(id, user, dto);
  }

  /** 项目详情 */
  @Get(':id')
  @ApiOperation({ summary: '查询项目详情（含成员、PR、认领记录）' })
  getById(@Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.projectsService.getById(id, query);
  }

  /** 查询项目成果：README、使用教程、展示地址与 Release 下载 */
  @Get(':id/deliverables')
  @ApiOperation({ summary: '查询项目成果展示数据' })
  getDeliverables(@Param('id') id: string) {
    return this.projectsService.getDeliverables(id);
  }

  /** 修改需求内容 */
  @Put(':id')
  @ApiOperation({ summary: '修改需求内容（需求方或管理员）' })
  update(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: UpdateProjectDto) {
    return this.projectsService.update(id, user, dto);
  }

  /** 认领需求 */
  @Post(':id/claim')
  @ApiOperation({ summary: '认领需求（先到先得），成功后自动创建仓库' })
  claim(@Param('id') id: string, @CurrentUser('id') userId: string, @Body() dto: ClaimProjectDto) {
    return this.projectsService.claim(id, userId, dto);
  }

  /** 创建或修复项目仓库 */
  @Post(':id/repository')
  @ApiOperation({ summary: '创建/修复项目仓库（负责人或管理员）' })
  ensureRepository(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateRepositoryDto,
  ) {
    return this.projectsService.ensureRepository(id, user, dto);
  }

  /** 同步仓库 Pull Request */
  @Post(':id/sync')
  @ApiOperation({ summary: '手动同步仓库 PR 状态（Webhook 兜底）' })
  sync(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.projectsService.syncPullRequests(id, user);
  }

  /** 变更项目状态 */
  @Patch(':id/status')
  @ApiOperation({ summary: '变更项目状态（负责人、需求方或管理员）' })
  updateStatus(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProjectStatusDto,
  ) {
    return this.projectsService.updateStatus(id, user, dto);
  }

  /** 将误认领或无法继续的需求交还需求池 */
  @Post(':id/return')
  @ApiOperation({ summary: '交还需求池，保留仓库与认领历史' })
  returnToPool(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: ReturnProjectDto) {
    return this.projectsService.returnToPool(id, user, dto);
  }

  /** 需求方提交试用验收结果 */
  @Post(':id/acceptance')
  @ApiOperation({ summary: '提交逐条试用验收结果' })
  submitAcceptance(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: SubmitAcceptanceDto) {
    return this.projectsService.submitAcceptance(id, user, dto);
  }

  /** 需求方催办项目 */
  @Post(':id/nudge')
  @ApiOperation({ summary: '催办项目负责人或提醒管理员' })
  nudge(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: NudgeProjectDto) {
    return this.projectsService.nudge(id, user, dto);
  }

  /** 添加协作者 */
  @Post(':id/members')
  @ApiOperation({ summary: '添加项目协作者，并同步仓库权限' })
  addMember(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: AddMemberDto) {
    return this.projectsService.addMember(id, user, dto);
  }

  /** 当前用户自助加入项目开发 */
  @Post(':id/join')
  @ApiOperation({ summary: '当前用户自助加入项目开发，成为协作者' })
  joinMember(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.projectsService.joinMember(id, user);
  }

  /** 移除协作者 */
  @Delete(':id/members/:userId')
  @ApiOperation({ summary: '移除项目协作者' })
  removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.projectsService.removeMember(id, user, userId);
  }

  /** 添加共同需求人（「我也需要」或需求方指定同事） */
  @Post(':id/requesters')
  @ApiOperation({ summary: '添加共同需求人：不传 userId 表示把自己加入' })
  addRequester(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: AddRequesterDto,
  ) {
    return this.projectsService.addRequester(id, user, dto);
  }

  /** 移除共同需求人（本人退出或需求方移除） */
  @Delete(':id/requesters/:userId')
  @ApiOperation({ summary: '移除共同需求人：本人退出或需求方移除' })
  removeRequester(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.projectsService.removeRequester(id, user, userId);
  }
}
