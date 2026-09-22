/**
 * 通知模块
 * 作用：注册邮件队列、邮件服务与通知服务，并作为全局模块对外提供
 */
import { QueueModule } from '../queue/queue.module';
import { EMAIL_QUEUE } from '../queue/queue.constants';
import { EmailProcessor } from './email.processor';
import { MailService } from './mail.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

@Global()
@Module({
  imports: [QueueModule, BullModule.registerQueue({ name: EMAIL_QUEUE })],
  controllers: [NotificationsController],
  providers: [NotificationsService, MailService, EmailProcessor],
  exports: [NotificationsService, MailService],
})
export class NotificationsModule {}
