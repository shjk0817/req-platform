/**
 * 用户服务
 * 作用：用户资料维护、同事检索，以及管理员对注册申请的审核
 *      审核通过时会自动在 Gitea 开通对应账号，实现平台与 Git 底座账号打通
 */
import { ListUsersQueryDto, ReviewUserDto, UpdateProfileDto } from './dto/users.dto';
import { GiteaService } from '../gitea/gitea.service';
import { MailService } from '../notifications/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { generatePassword } from '../common/utils/naming.util';
import { buildPaginated, PaginationQueryDto } from '../common/dto/pagination.dto';
import { isAllowedAvatar, USER_AVATAR_PRESETS } from '../common/constants/avatars';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationType, Prisma, Role, UserStatus } from '@prisma/client';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gitea: GiteaService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 管理员分页查询用户列表
   * @param query 查询条件
   */
  async list(query: ListUsersQueryDto) {
    const where: Prisma.UserWhereInput = {};
    if (query.status) {
      where.status = query.status;
    }
    if (query.role) {
      where.role = query.role;
    }
    if (query.keyword) {
      where.OR = [
        { name: { contains: query.keyword, mode: 'insensitive' } },
        { email: { contains: query.keyword, mode: 'insensitive' } },
        { department: { contains: query.keyword, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: this.publicSelect,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return buildPaginated(items, total, query);
  }

  /**
   * 查询同事列表（用于挑选协作的同事）
   * @param query 分页与关键字
   */
  async listDevelopers(query: PaginationQueryDto) {
    const where: Prisma.UserWhereInput = { status: UserStatus.ACTIVE };
    if (query.keyword) {
      where.OR = [
        { name: { contains: query.keyword, mode: 'insensitive' } },
        { skills: { has: query.keyword } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: { id: true, name: true, department: true, skills: true, avatarUrl: true, giteaUsername: true },
        orderBy: { name: 'asc' },
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return buildPaginated(items, total, query);
  }

  /**
   * 查询指定用户详情
   * @param id 用户主键
   */
  async getById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: this.publicSelect });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    return user;
  }

  /**
   * 修改当前用户资料
   * @param userId 用户主键
   * @param dto 待修改字段
   */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (dto.avatarUrl !== undefined && !isAllowedAvatar(dto.avatarUrl, USER_AVATAR_PRESETS)) {
      throw new BadRequestException('头像不在可选范围内');
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        name: dto.name,
        department: dto.department,
        skills: dto.skills,
        avatarUrl: dto.avatarUrl,
      },
      select: this.publicSelect,
    });
  }

  /**
   * 管理员审核用户
   * @param adminId 管理员主键
   * @param targetId 目标用户主键
   * @param dto 审核动作
   */
  async review(adminId: string, targetId: string, dto: ReviewUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    if (dto.action === 'reject') {
      // 驳回注册申请：删除记录，允许申请人修正后重新注册
      await this.prisma.user.delete({ where: { id: targetId } });
      await this.mail.send({
        to: user.email,
        subject: '【需求协作平台】注册申请未通过',
        text: `你好 ${user.name}：\n\n你的注册申请未通过审核。${dto.remark ?? ''}\n如有疑问请联系平台管理员。`,
      });
      return { message: '已驳回该注册申请' };
    }

    if (dto.action === 'disable') {
      await this.prisma.user.update({ where: { id: targetId }, data: { status: UserStatus.DISABLED } });
      if (user.giteaUsername) {
        await this.gitea.setUserActive(user.giteaUsername, false).catch(() => undefined);
      }
      await this.notifications.create({
        userId: targetId,
        type: NotificationType.USER_APPROVED,
        title: '账号已被停用',
        content: dto.remark ?? '你的账号已被管理员停用，如有疑问请联系管理员。',
      });
      return { message: '账号已停用' };
    }

    if (dto.action === 'enable') {
      await this.prisma.user.update({ where: { id: targetId }, data: { status: UserStatus.ACTIVE } });
      if (user.giteaUsername) {
        await this.gitea.setUserActive(user.giteaUsername, true).catch(() => undefined);
      }
      return { message: '账号已启用' };
    }

    // 审核通过
    const credential = await this.provisionGiteaAccount(user);
    await this.prisma.user.update({
      where: { id: targetId },
      data: {
        status: UserStatus.ACTIVE,
        giteaUsername: credential?.username ?? user.giteaUsername,
        approvedById: adminId,
        approvedAt: new Date(),
      },
    });

    await this.notifications.create({
      userId: targetId,
      type: NotificationType.USER_APPROVED,
      title: '账号审核通过',
      content: `欢迎加入需求协作平台！现在可以发布需求或认领项目了。${dto.remark ?? ''}`,
      link: '/',
      sendMail: false,
    });

    if (credential) {
      const gitUrl = this.config.get<string>('gitea.rootUrl') ?? '';
      await this.mail.send({
        to: user.email,
        subject: '【需求协作平台】账号已开通',
        text: [
          `你好 ${user.name}：`,
          '',
          '你的需求协作平台账号已审核通过。',
          `Git 服务地址：${gitUrl}`,
          `Git 账号：${credential.username}`,
          `Git 初始密码：${credential.password}`,
          '',
          '首次登录 Git 服务后请立即修改密码，并上传 SSH 公钥以便推送代码。',
        ].join('\n'),
      });
    }

    return {
      message: '审核通过，Git 账号已开通',
      giteaUsername: credential?.username ?? null,
      // 初始密码仅在此处返回一次，便于管理员线下告知
      giteaInitialPassword: credential?.password ?? null,
    };
  }

  /**
   * 管理员为用户重置 Git 账号密码
   * @param targetId 目标用户主键
   */
  async resetGiteaPassword(targetId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    if (!user.giteaUsername) {
      throw new BadRequestException('该用户尚未开通 Git 账号');
    }
    const password = generatePassword(14);
    await this.gitea.resetUserPassword(user.giteaUsername, password);
    await this.mail.send({
      to: user.email,
      subject: '【需求协作平台】Git 账号密码已重置',
      text: `你好 ${user.name}：\n\n你的 Git 账号 ${user.giteaUsername} 密码已被重置，新密码：${password}\n请登录后立即修改。`,
    });
    return { giteaUsername: user.giteaUsername, giteaInitialPassword: password };
  }

  /**
   * 在 Gitea 中开通账号；未配置 Gitea 时跳过并记录日志
   * @param user 平台用户
   */
  private async provisionGiteaAccount(user: {
    email: string;
    name: string;
    giteaUsername: string | null;
  }): Promise<{ username: string; password: string } | null> {
    return this.gitea.provisionUserAccount({
      email: user.email,
      name: user.name,
      existingUsername: user.giteaUsername,
    });
  }

  /** 列表与详情统一使用的安全字段集合 */
  private readonly publicSelect = {
    id: true,
    email: true,
    name: true,
    role: true,
    status: true,
    department: true,
    skills: true,
    avatarUrl: true,
    giteaUsername: true,
    approvedAt: true,
    createdAt: true,
  } satisfies Prisma.UserSelect;

  /** 判断是否为管理员（供其他模块复用） */
  isAdmin(role: Role): boolean {
    return role === Role.ADMIN;
  }
}
