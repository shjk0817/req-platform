/**
 * 通知控制器
 * 作用：提供站内通知的查询与已读操作
 */
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('通知')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /** 分页查询我的通知 */
  @Get()
  @ApiOperation({ summary: '分页查询我的通知' })
  list(@CurrentUser('id') userId: string, @Query() query: PaginationQueryDto) {
    return this.notificationsService.listMine(userId, query);
  }

  /** 查询未读数量 */
  @Get('unread-count')
  @ApiOperation({ summary: '查询未读通知数量' })
  unreadCount(@CurrentUser('id') userId: string) {
    return this.notificationsService.countUnread(userId);
  }

  /** 标记单条通知已读 */
  @Post(':id/read')
  @ApiOperation({ summary: '标记通知为已读' })
  markRead(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.notificationsService.markRead(userId, id);
  }

  /** 标记全部通知已读 */
  @Post('read-all')
  @ApiOperation({ summary: '标记全部通知为已读' })
  markAllRead(@CurrentUser('id') userId: string) {
    return this.notificationsService.markAllRead(userId);
  }
}
