/**
 * Gitea Webhook 接收控制器
 * 作用：接收 Gitea 推送的仓库事件，校验签名后交给业务服务处理
 */
import { GiteaService } from './gitea.service';
import { GiteaWebhookService } from './gitea-webhook.service';
import { CiCallbackPayload } from './dto/gitea-webhook.dto';
import { Public } from '../common/decorators/public.decorator';
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request } from 'express';

@ApiExcludeController()
@Controller('webhooks')
export class GiteaWebhookController {
  private readonly logger = new Logger(GiteaWebhookController.name);

  constructor(
    private readonly gitea: GiteaService,
    private readonly webhookService: GiteaWebhookService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 接收 Gitea Webhook
   * @param req 原始请求（需开启 rawBody 以校验签名）
   * @param event 事件类型
   * @param signature HMAC 签名
   */
  @Public()
  @Post('gitea')
  @HttpCode(202)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-gitea-event') event: string,
    @Headers('x-gitea-signature') signature?: string,
  ) {
    if (!this.gitea.verifyWebhookSignature(req.rawBody, signature)) {
      this.logger.warn('Webhook 签名校验失败，已拒绝该请求');
      throw new UnauthorizedException('Webhook 签名校验失败');
    }

    try {
      await this.webhookService.dispatch(event, req.body);
    } catch (error) {
      // 处理失败不影响 Gitea 侧投递结果，记录日志便于排查
      this.logger.error(`处理 Webhook 事件 ${event} 失败: ${(error as Error).message}`, (error as Error).stack);
    }
    return { ok: true };
  }

  /**
   * 接收仓库流水线主动上报的状态（Gitea 1.22 的 Webhook 不支持订阅流水线事件）
   * @param payload 上报内容
   * @param token 回调令牌（工作流中以环境变量注入）
   */
  @Public()
  @Post('ci')
  @HttpCode(202)
  async handleCiStatus(
    @Body() payload: CiCallbackPayload,
    @Headers('x-ci-token') token?: string,
  ) {
    const expected = this.config.get<string>('ci.callbackToken') ?? '';
    if (!expected || token !== expected) {
      this.logger.warn('流水线回调令牌校验失败，已拒绝该请求');
      throw new UnauthorizedException('流水线回调令牌校验失败');
    }

    try {
      await this.webhookService.reportCiStatus(payload);
    } catch (error) {
      this.logger.error(`处理流水线回调失败: ${(error as Error).message}`, (error as Error).stack);
    }
    return { ok: true };
  }
}
