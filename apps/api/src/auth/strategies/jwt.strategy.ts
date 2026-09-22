/**
 * JWT 认证策略
 * 作用：解析请求头中的 Bearer Token，校验用户状态并注入到请求上下文
 */
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { JwtPayload } from '../../common/interfaces/auth-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { UserStatus } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.secret') as string,
    });
  }

  /**
   * 校验 Token 载荷并把用户信息挂载到 request.user
   * @param payload JWT 载荷
   */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new UnauthorizedException('账号不存在');
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('账号尚未通过审核或已被停用');
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      giteaUsername: user.giteaUsername,
      authMethod: 'jwt',
    };
  }
}
