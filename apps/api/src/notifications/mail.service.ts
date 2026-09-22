/**
 * 邮件服务
 * 作用：封装 nodemailer 发送逻辑；未开启邮件时降级为日志输出
 */
import { EmailJobData } from '../queue/queue.constants';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private enabled = false;

  constructor(private readonly config: ConfigService) {}

  /** 初始化 SMTP 连接，未配置时保持禁用状态 */
  onModuleInit(): void {
    this.enabled = this.config.get<boolean>('mail.enabled') ?? false;
    const host = this.config.get<string>('mail.host') ?? '';
    if (!this.enabled || !host) {
      this.logger.log('邮件通知未启用，将仅记录日志');
      return;
    }
    this.transporter = nodemailer.createTransport({
      host,
      port: this.config.get<number>('mail.port'),
      secure: this.config.get<boolean>('mail.secure'),
      auth: {
        user: this.config.get<string>('mail.user') ?? '',
        pass: this.config.get<string>('mail.password') ?? '',
      },
    });
    this.logger.log(`邮件通知已启用: ${host}`);
  }

  /**
   * 发送邮件
   * @param data 邮件内容
   */
  async send(data: EmailJobData): Promise<void> {
    if (!this.enabled || !this.transporter) {
      this.logger.log(`[邮件跳过] 收件人=${data.to} 主题=${data.subject}`);
      return;
    }
    try {
      await this.transporter.sendMail({
        from: this.config.get<string>('mail.from'),
        to: data.to,
        subject: data.subject,
        text: data.text,
        html: data.html ?? data.text.replace(/\n/g, '<br/>'),
      });
      this.logger.log(`邮件已发送: ${data.to} - ${data.subject}`);
    } catch (error) {
      // 邮件失败不应影响主流程，仅记录日志
      this.logger.error(`邮件发送失败: ${(error as Error).message}`);
    }
  }
}
