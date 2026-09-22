/**
 * 邮件队列处理器
 * 作用：异步消费邮件任务，避免阻塞接口响应
 */
import { MailService } from './mail.service';
import { EMAIL_QUEUE, EmailJobData } from '../queue/queue.constants';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

@Processor(EMAIL_QUEUE)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private readonly mail: MailService) {
    super();
  }

  /** 消费邮件任务 */
  async process(job: Job<EmailJobData>): Promise<void> {
    this.logger.debug(`处理邮件任务 ${job.id}`);
    await this.mail.send(job.data);
  }
}
