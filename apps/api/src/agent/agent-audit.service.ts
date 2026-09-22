/**
 * Agent 操作审计服务
 * 作用：记录 CLI / MCP 发起的写操作，输入只保留业务参数，不记录令牌与密码
 */
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class AgentAuditService {
  private readonly logger = new Logger(AgentAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 写入审计事件，审计失败不阻断业务请求 */
  async record(
    user: AuthUser,
    action: string,
    resource: string,
    resourceId?: string,
    requestId?: string,
    input?: unknown,
  ): Promise<void> {
    try {
      await this.prisma.agentAuditEvent.create({
        data: {
          userId: user.id,
          tokenId: user.tokenId,
          action,
          resource,
          resourceId,
          requestId,
          input: this.toJson(input),
        },
      });
    } catch (error) {
      this.logger.warn(`Agent 审计写入失败: ${(error as Error).message}`);
    }
  }

  /** Prisma Json 字段只接受可序列化对象 */
  private toJson(input: unknown): object | undefined {
    if (input === undefined) {
      return undefined;
    }
    try {
      return JSON.parse(JSON.stringify(input)) as object;
    } catch {
      return { value: '[unserializable]' };
    }
  }
}
