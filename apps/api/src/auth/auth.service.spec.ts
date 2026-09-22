/**
 * 认证服务单测
 * 作用：验证开发账号选择器只在非生产环境返回 ACTIVE 账号与开发密码
 */
import { AuthService } from './auth.service';
import { ForbiddenException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';

/** 构造最小可用于签发会话的测试用户 */
function makeUser(role: Role = Role.EMPLOYEE) {
  return {
    id: 'user-1',
    email: role === Role.ADMIN ? 'admin@example.com' : 'employee@example.com',
    name: role === Role.ADMIN ? '管理员' : '普通用户',
    role,
    status: UserStatus.ACTIVE,
    password: 'stored-password-hash',
    department: null,
    skills: [],
    avatarUrl: null,
    giteaUsername: 'tester',
  };
}

/** 构造开发账号选择器所需的最小依赖 */
function createService(configValues: Record<string, unknown>, user = makeUser()) {
  const prisma = {
    user: {
      findMany: jest.fn().mockResolvedValue([user]),
      findFirst: jest.fn().mockResolvedValue(user),
      findUnique: jest.fn().mockResolvedValue(user),
    },
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('jwt-token') };
  const config = {
    get: jest.fn((key: string) => configValues[key]),
  };
  return {
    service: new AuthService(prisma as never, jwt as never, config as never, {} as never),
    prisma,
  };
}

describe('AuthService.getDevUsers', () => {
  it('生产环境拒绝返回开发账号选择器数据', async () => {
    const production = createService({ 'env': 'production' });
    await expect(production.service.getDevUsers()).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('开发环境返回 ACTIVE 用户并按角色填充开发密码', async () => {
    const { service, prisma } = createService(
      {
        'env': 'development',
        'devPicker.enabled': true,
        'devPicker.adminPassword': 'Admin@dev',
        'devPicker.userPassword': 'User@dev',
      },
      makeUser(Role.ADMIN),
    );
    const employee = makeUser(Role.EMPLOYEE);
    prisma.user.findMany.mockResolvedValue([employee, makeUser(Role.ADMIN)]);

    await expect(service.getDevUsers()).resolves.toEqual([
      expect.objectContaining({ role: Role.ADMIN, password: 'Admin@dev' }),
      expect.objectContaining({ role: Role.EMPLOYEE, password: 'User@dev' }),
    ]);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { status: UserStatus.ACTIVE },
      select: { id: true, email: true, name: true, role: true },
      orderBy: { createdAt: 'asc' },
    });
  });
});

describe('AuthService.login', () => {
  it('开发账号选择器密码可登录任意 ACTIVE 用户，但只在开发环境生效', async () => {
    const { service } = createService(
      {
        'env': 'development',
        'devPicker.enabled': true,
        'devPicker.adminPassword': 'Admin@dev',
        'devPicker.userPassword': 'User@dev',
        'jwt.expiresIn': '7d',
        'jwt.secret': 'test-secret',
      },
      makeUser(Role.EMPLOYEE),
    );

    await expect(
      service.login({ email: 'employee@example.com', password: 'User@dev' }),
    ).resolves.toMatchObject({
      token: 'jwt-token',
      user: { role: Role.EMPLOYEE, status: UserStatus.ACTIVE },
    });
  });
});
