/**
 * 机器令牌服务单测
 * 作用：验证令牌只保存哈希、范围默认值与撤销/过期校验
 */
import { IntegrationService } from './integration.service';
import { Role, UserStatus } from '@prisma/client';

function createService() {
  const prisma = {
    integrationToken: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  return { service: new IntegrationService(prisma as never), prisma };
}

describe('IntegrationService', () => {
  it('创建令牌时只把哈希写入数据库，并默认包含 read scope', async () => {
    const { service, prisma } = createService();
    prisma.integrationToken.create.mockResolvedValue({
      id: 'token-1',
      name: 'Cursor',
      tokenPrefix: 'aim_12345678',
      scopes: ['read'],
      expiresAt: null,
    });

    const result = await service.create('user-1', { name: 'Cursor' });

    expect(result.token).toMatch(/^aim_/);
    expect(prisma.integrationToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          scopes: ['read'],
          tokenHash: expect.not.stringMatching(result.token),
        }),
      }),
    );
  });

  it('可解析有效令牌，并异步更新最后使用时间', async () => {
    const { service, prisma } = createService();
    prisma.integrationToken.findUnique.mockResolvedValue({
      id: 'token-1',
      scopes: ['read', 'git:metadata'],
      revokedAt: null,
      expiresAt: null,
      user: {
        id: 'user-1',
        email: 'employee@example.com',
        name: '员工',
        role: Role.EMPLOYEE,
        status: UserStatus.ACTIVE,
        giteaUsername: 'employee',
      },
    });
    prisma.integrationToken.update.mockResolvedValue({});

    const result = await service.authenticate('aim_test-token');

    expect(result).toMatchObject({
      id: 'user-1',
      authMethod: 'pat',
      tokenId: 'token-1',
      scopes: ['read', 'git:metadata'],
    });
    expect(prisma.integrationToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'token-1' } }),
    );
  });

  it('撤销或过期的令牌不能认证', async () => {
    const { service, prisma } = createService();
    prisma.integrationToken.findUnique.mockResolvedValue({
      revokedAt: new Date(),
      expiresAt: null,
      user: { status: UserStatus.ACTIVE },
    });

    await expect(service.authenticate('aim_revoked')).resolves.toBeNull();
  });
});
