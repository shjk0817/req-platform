/**
 * 管理员账号引导服务
 * 作用：应用启动时确保平台至少存在一个可登录的管理员账号，
 *      避免首次部署后无人可以审核注册申请；
 *      同时保证该管理员在 Gitea 中有对应账号，从而可以免密进入 Git 服务
 */
import { PrismaService } from '../prisma/prisma.service';
import { GiteaService } from '../gitea/gitea.service';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly gitea: GiteaService,
  ) {}

  /** 启动时检查并创建初始管理员，并确保其 Git 账号可用 */
  async onApplicationBootstrap(): Promise<void> {
    const existing = await this.prisma.user.findFirst({
      where: { role: Role.ADMIN },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, name: true, giteaUsername: true },
    });

    if (existing) {
      this.logger.log(`平台已存在管理员账号: ${existing.email}，跳过创建`);
      await this.ensureGiteaAccount(existing);
      return;
    }

    const email = this.config.get<string>('admin.email') ?? 'admin@example.com';
    const password = this.config.get<string>('admin.password') ?? 'Admin@123456';
    const name = this.config.get<string>('admin.name') ?? '平台管理员';

    const created = await this.prisma.user.create({
      data: {
        email,
        name,
        password: await bcrypt.hash(password, 10),
        role: Role.ADMIN,
        status: UserStatus.ACTIVE,
        department: '平台管理',
      },
      select: { id: true, email: true, name: true, giteaUsername: true },
    });
    this.logger.warn(`已创建初始管理员账号: ${email}，请登录后立即修改密码`);

    await this.ensureGiteaAccount(created);
  }

  /**
   * 保证管理员拥有可用的 Git 账号，使其点击「代码仓库」即可免密进入
   * 优先绑定 Gitea 站点管理员账号（GITEA_ADMIN_USER），否则自动开通一个普通账号
   * @param admin 平台管理员
   */
  private async ensureGiteaAccount(admin: {
    id: string;
    email: string;
    name: string;
    giteaUsername: string | null;
  }): Promise<void> {
    if (!this.gitea.isConfigured) {
      this.logger.warn('Gitea 未配置 API Token，跳过管理员 Git 账号绑定');
      return;
    }
    if (admin.giteaUsername) {
      const exists = await this.gitea.getUser(admin.giteaUsername).catch(() => null);
      if (exists) {
        return;
      }
    }

    // 优先复用 Gitea 站点管理员账号，避免同一个人管理两套账号
    const siteAdmin = this.config.get<string>('gitea.adminUser') ?? '';
    if (siteAdmin) {
      const siteAdminAccount = await this.gitea.getUser(siteAdmin).catch(() => null);
      if (siteAdminAccount && !(await this.isBoundByOthers(siteAdmin, admin.id))) {
        await this.prisma.user.update({
          where: { id: admin.id },
          data: { giteaUsername: siteAdmin },
        });
        this.logger.log(`管理员 ${admin.email} 已绑定 Gitea 站点管理员账号: ${siteAdmin}`);
        return;
      }
    }

    const created = await this.gitea
      .provisionUserAccount({ email: admin.email, name: admin.name, existingUsername: null })
      .catch((error: Error) => {
        this.logger.warn(`管理员 Git 账号开通失败: ${error.message}`);
        return null;
      });
    if (!created) {
      return;
    }
    await this.prisma.user.update({
      where: { id: admin.id },
      data: { giteaUsername: created.username },
    });
    this.logger.log(`管理员 ${admin.email} 已开通 Git 账号: ${created.username}`);
  }

  /**
   * 判断某个 Git 用户名是否已被其他平台用户占用
   * @param giteaUsername Git 用户名
   * @param adminId 当前管理员主键
   */
  private async isBoundByOthers(giteaUsername: string, adminId: string): Promise<boolean> {
    const other = await this.prisma.user.findFirst({
      where: { giteaUsername, id: { not: adminId } },
      select: { id: true },
    });
    return Boolean(other);
  }
}
