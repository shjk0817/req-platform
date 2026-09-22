/**
 * 机器客户端令牌控制器
 * 作用：给员工提供可撤销、可限权的 CLI / MCP 访问凭据管理入口
 */
import { CreateIntegrationTokenDto } from './dto/integration.dto';
import { IntegrationService } from './integration.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('机器客户端')
@ApiBearerAuth()
@Controller('integrations/tokens')
export class IntegrationController {
  constructor(private readonly integrationService: IntegrationService) {}

  /** 创建个人访问令牌，明文只在响应中出现一次 */
  @Post()
  @ApiOperation({ summary: '创建 CLI / MCP 个人访问令牌' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateIntegrationTokenDto) {
    this.integrationService.assertInteractiveSession(user);
    return this.integrationService.create(user.id, dto);
  }

  /** 查询当前用户的令牌摘要 */
  @Get()
  @ApiOperation({ summary: '查询个人访问令牌摘要' })
  list(@CurrentUser() user: AuthUser) {
    this.integrationService.assertInteractiveSession(user);
    return this.integrationService.list(user.id);
  }

  /** 撤销当前用户的令牌 */
  @Delete(':id')
  @ApiOperation({ summary: '撤销个人访问令牌' })
  revoke(@CurrentUser() user: AuthUser, @Param('id') tokenId: string) {
    this.integrationService.assertInteractiveSession(user);
    return this.integrationService.revoke(user.id, tokenId);
  }
}
