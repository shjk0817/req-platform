/**
 * 认证服务
 * 作用：处理员工注册、登录、修改密码与个人信息查询
 */
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { NotificationType, Role, UserStatus } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * 员工注册：创建待审核账号，并通知所有管理员
   * @param dto 注册信息
   */
  async register(dto: RegisterDto) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) {
      throw new ConflictException('该邮箱已注册，请直接登录或联系管理员');
    }

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        department: dto.department,
        skills: dto.skills ?? [],
        password: await bcrypt.hash(dto.password, 10),
        status: UserStatus.PENDING,
        role: Role.EMPLOYEE,
      },
    });

    // 通知所有管理员有新账号待审核
    const admins = await this.prisma.user.findMany({
      where: { role: Role.ADMIN, status: UserStatus.ACTIVE },
      select: { id: true },
    });
    await Promise.all(
      admins.map((admin) =>
        this.notifications.create({
          userId: admin.id,
          type: NotificationType.USER_APPROVED,
          title: '有新的注册申请待审核',
          content: `${user.name}（${user.email}）提交了注册申请，请前往用户管理审核。`,
          link: '/admin/users',
        }),
      ),
    );

    this.logger.log(`新用户注册待审核: ${user.email}`);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      message: '注册成功，请等待管理员审核通过后再登录',
    };
  }

  /**
   * 登录：校验密码与账号状态，签发 JWT
   * @param dto 登录信息
   */
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      throw new UnauthorizedException('邮箱或密码错误');
    }

    const valid = await bcrypt.compare(dto.password, user.password);
    const devPickerEnabled = this.config.get<boolean>('devPicker.enabled') ?? false;
    const env = this.config.get<string>('env') ?? 'development';
    const devPickerPassword =
      user.role === Role.ADMIN
        ? this.config.get<string>('devPicker.adminPassword')
        : this.config.get<string>('devPicker.userPassword');
    const validDevPickerPassword =
      env !== 'production' && devPickerEnabled && dto.password === devPickerPassword;
    if (!valid && !validDevPickerPassword) {
      throw new UnauthorizedException('邮箱或密码错误');
    }

    if (user.status === UserStatus.PENDING) {
      throw new ForbiddenException('账号尚未通过管理员审核，请耐心等待');
    }
    if (user.status === UserStatus.DISABLED) {
      throw new ForbiddenException('账号已被停用，请联系管理员');
    }

    return this.createSession(user);
  }

  /**
   * 获取开发环境账号选择器数据
   * 作用：只返回 ACTIVE 账号和开发环境约定密码，前端随后仍调用普通密码登录接口。
   */
  async getDevUsers() {
    const env = this.config.get<string>('env') ?? 'development';
    const enabled = this.config.get<boolean>('devPicker.enabled') ?? false;
    if (env === 'production' || !enabled) {
      throw new ForbiddenException('开发账号选择器未开启或当前环境不允许');
    }

    const users = await this.prisma.user.findMany({
      where: { status: UserStatus.ACTIVE },
      select: { id: true, email: true, name: true, role: true },
      orderBy: { createdAt: 'asc' },
    });
    const adminPassword = this.config.get<string>('devPicker.adminPassword') ?? 'Admin@123456';
    const userPassword = this.config.get<string>('devPicker.userPassword') ?? 'Demo@123456';

    return users
      .sort((left, right) => (left.role === right.role ? 0 : left.role === Role.ADMIN ? -1 : 1))
      .map((user) => ({
        ...user,
        password: user.role === Role.ADMIN ? adminPassword : userPassword,
      }));
  }

  /**
   * 修改当前用户密码
   * @param userId 用户主键
   * @param dto 原密码与新密码
   */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const valid = await bcrypt.compare(dto.oldPassword, user.password);
    if (!valid) {
      throw new UnauthorizedException('原密码不正确');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: await bcrypt.hash(dto.newPassword, 10) },
    });
    return { message: '密码修改成功' };
  }

  /**
   * 查询当前登录用户完整信息
   * @param userId 用户主键
   */
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return {
      ...this.toProfile(user),
      skills: user.skills,
      department: user.department,
      createdAt: user.createdAt,
    };
  }

  /**
   * 统一签发平台 JWT，保证普通登录与开发登录的会话结构完全一致
   * @param user 已通过状态校验的用户
   */
  private async createSession(user: {
    id: string;
    email: string;
    role: Role;
    status: UserStatus;
    name: string;
    department: string | null;
    skills: string[];
    avatarUrl: string | null;
    giteaUsername: string | null;
  }) {
    const expiresIn = this.config.get<string>('jwt.expiresIn') as string;
    const token = await this.jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role },
      { secret: this.config.get<string>('jwt.secret'), expiresIn },
    );
    return { token, user: this.toProfile(user) };
  }

  /** 过滤敏感字段后的用户信息 */
  private toProfile(user: {
    id: string;
    email: string;
    name: string;
    role: Role;
    status: UserStatus;
    department: string | null;
    skills: string[];
    avatarUrl?: string | null;
    giteaUsername: string | null;
  }) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      department: user.department,
      skills: user.skills,
      avatarUrl: user.avatarUrl ?? null,
      giteaUsername: user.giteaUsername,
    };
  }
}
