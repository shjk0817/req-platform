/**
 * Gitea 集成模块
 * 作用：对外提供 Gitea API 客户端、Webhook 处理能力与免密登录（SSO）入口
 */
import { GiteaController } from './gitea.controller';
import { GiteaService } from './gitea.service';
import { GiteaSsoController, GiteaAuthBridgeController } from './gitea-sso.controller';
import { GiteaSsoService } from './gitea-sso.service';
import { GiteaWebhookController } from './gitea-webhook.controller';
import { GiteaWebhookService } from './gitea-webhook.service';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    // SSO Cookie 复用平台登录令牌的签名密钥
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
        signOptions: { expiresIn: config.get<string>('jwt.expiresIn') },
      }),
    }),
  ],
  controllers: [GiteaController, GiteaWebhookController, GiteaSsoController, GiteaAuthBridgeController],
  providers: [GiteaService, GiteaWebhookService, GiteaSsoService],
  exports: [GiteaService],
})
export class GiteaModule {}
