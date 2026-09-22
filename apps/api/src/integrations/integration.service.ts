/**
 * 机器客户端令牌服务
 * 作用：签发、校验、列出与撤销个人访问令牌；数据库永不保存令牌明文
 */
import { CreateIntegrationTokenDto } from './dto/integration.dto';
import { INTEGRATION_SCOPES, IntegrationScope } from './integration.constants';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';

/** 令牌返回结构，不包含哈希 */
export interface IntegrationTokenSummary {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

@Injectable()
export class IntegrationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 创建个人访问令牌
   * @param userId 当前用户主键
   * @param dto 令牌描述与权限范围
   */
  async create(userId: string, dto: CreateIntegrationTokenDto) {
    const scopes = this.normalizeScopes(dto.scopes);
    const rawToken = `aim_${randomBytes(32).toString('base64url')}`;
    const tokenPrefix = rawToken.slice(0, 12);
    const expiresAt = dto.expiresInDays
      ? new Date(Date.now() + dto.expiresInDays * 24 * 60 * 60 * 1000)
      : null;
    const token = await this.prisma.integrationToken.create({
      data: {
        userId,
        name: dto.name.trim(),
        tokenHash: this.hash(rawToken),
        tokenPrefix,
        scopes,
        expiresAt,
      },
    });

    return {
      token: rawToken,
      tokenId: token.id,
      name: token.name,
      tokenPrefix: token.tokenPrefix,
      scopes: token.scopes,
      expiresAt: token.expiresAt?.toISOString() ?? null,
      message: '令牌只会显示这一次，请立即保存到系统钥匙串',
    };
  }

  /** 列出当前用户的令牌摘要 */
  async list(userId: string): Promise<IntegrationTokenSummary[]> {
    const tokens = await this.prisma.integrationToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return tokens.map((token) => this.toSummary(token));
  }

  /**
   * 撤销当前用户的令牌
   * @param userId 当前用户主键
   * @param tokenId 令牌主键
   */
  async revoke(userId: string, tokenId: string) {
    await this.prisma.integrationToken.updateMany({
      where: { id: tokenId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { message: '令牌已撤销' };
  }

  /**
   * 用原始令牌解析机器用户
   * @param rawToken Authorization Bearer 中的令牌
   */
  async authenticate(rawToken: string): Promise<AuthUser | null> {
    if (!rawToken.startsWith('aim_')) {
      return null;
    }
    const token = await this.prisma.integrationToken.findUnique({
      where: { tokenHash: this.hash(rawToken) },
      include: {
        user: {
          select: { id: true, email: true, name: true, role: true, status: true, giteaUsername: true },
        },
      },
    });
    if (
      !token ||
      token.revokedAt ||
      (token.expiresAt && token.expiresAt.getTime() <= Date.now()) ||
      token.user.status !== UserStatus.ACTIVE
    ) {
      return null;
    }

    void this.prisma.integrationToken.update({
      where: { id: token.id },
      data: { lastUsedAt: new Date() },
    });
    return {
      id: token.user.id,
      email: token.user.email,
      name: token.user.name,
      role: token.user.role,
      giteaUsername: token.user.giteaUsername,
      authMethod: 'pat',
      tokenId: token.id,
      scopes: token.scopes,
    };
  }

  /** 令牌管理必须来自登录态，避免 PAT 无限创建新 PAT */
  assertInteractiveSession(user: AuthUser): void {
    if (user.authMethod === 'pat') {
      throw new ForbiddenException('请使用平台登录态管理个人访问令牌');
    }
  }

  /** 检查令牌范围是否包含目标权限 */
  hasScope(user: AuthUser, scope: IntegrationScope): boolean {
    return user.authMethod === 'pat' && Boolean(user.scopes?.includes(scope));
  }

  private normalizeScopes(scopes?: IntegrationScope[]): IntegrationScope[] {
    const normalized: IntegrationScope[] = [...new Set<IntegrationScope>(scopes?.length ? scopes : ['read'])];
    if (normalized.includes('read') || normalized.includes('project:write')) {
      return normalized;
    }
    return ['read', ...normalized];
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private toSummary(token: {
    id: string;
    name: string;
    tokenPrefix: string;
    scopes: string[];
    expiresAt: Date | null;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
  }): IntegrationTokenSummary {
    return {
      id: token.id,
      name: token.name,
      tokenPrefix: token.tokenPrefix,
      scopes: token.scopes,
      expiresAt: token.expiresAt?.toISOString() ?? null,
      lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
      revokedAt: token.revokedAt?.toISOString() ?? null,
      createdAt: token.createdAt.toISOString(),
    };
  }
}
