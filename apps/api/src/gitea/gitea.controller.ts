/**
 * Gitea 健康检查控制器
 * 作用：供管理员在平台上确认 Git 底座连通状态
 */
import { GiteaService } from './gitea.service';
import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Gitea 集成')
@ApiBearerAuth()
@Controller('gitea')
export class GiteaController {
  constructor(private readonly gitea: GiteaService) {}

  /** 查询 Gitea 连接状态与仓库组织信息 */
  @Get('status')
  @ApiOperation({ summary: '查询 Gitea 连接状态' })
  async status() {
    const configured = this.gitea.isConfigured;
    if (!configured) {
      return { configured: false, reachable: false, org: this.gitea.org, message: '尚未配置 Gitea API Token' };
    }
    try {
      const org = await this.gitea.request<{ id: number; name: string }>(
        `/api/v1/orgs/${this.gitea.org}`,
        { ignoreNotFound: true },
      );
      return {
        configured: true,
        reachable: Boolean(org),
        org: this.gitea.org,
        orgExists: Boolean(org),
        rootUrl: this.gitea.publicRootUrl,
      };
    } catch (error) {
      return {
        configured: true,
        reachable: false,
        org: this.gitea.org,
        message: (error as Error).message,
      };
    }
  }
}
