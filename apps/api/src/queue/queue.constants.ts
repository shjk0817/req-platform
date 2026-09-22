/**
 * 队列常量定义
 * 作用：集中管理 BullMQ 队列名称，避免各处硬编码字符串
 */
export const EMAIL_QUEUE = 'email';

/** 邮件任务载荷 */
export interface EmailJobData {
  /** 收件人邮箱 */
  to: string;
  /** 邮件标题 */
  subject: string;
  /** 纯文本正文 */
  text: string;
  /** HTML 正文 */
  html?: string;
}
