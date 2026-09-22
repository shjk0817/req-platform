/**
 * 文案与状态映射
 * 作用：集中维护中文标签与颜色，避免各页面重复定义
 */
import type { FeedbackStatus, FeedbackType, ProjectStatus, UserStatus } from './types';

/** 项目状态 -> 中文与颜色 */
export const PROJECT_STATUS_MAP: Record<ProjectStatus, { text: string; color: string }> = {
  OPEN: { text: '等同事接手', color: 'orange' },
  CLAIMED: { text: '已有人接手', color: 'blue' },
  DEVELOPING: { text: '正在做', color: 'geekblue' },
  RELEASED: { text: '请你试用', color: 'green' },
  CLOSED: { text: '已结束', color: 'default' },
};

/** 项目阶段的人话说明，放在状态标签旁帮助非技术用户理解下一步 */
export const PROJECT_STAGE_HELP: Record<ProjectStatus, string> = {
  OPEN: '还没有同事接手，你可以补充说明或邀请熟悉的人看看。',
  CLAIMED: '同事已经接手，还没开始修改；你现在只需要等待。',
  DEVELOPING: '同事正在修改，遇到问题可以在反馈里说明。',
  RELEASED: '负责人已经完成一版，请按验收清单试用。',
  CLOSED: '这条需求已经结束，不会再继续推进。',
};

/** 反馈类型 -> 中文与颜色 */
export const FEEDBACK_TYPE_MAP: Record<FeedbackType, { text: string; color: string }> = {
  BUG: { text: '缺陷', color: 'red' },
  IMPROVEMENT: { text: '改进建议', color: 'blue' },
  QUESTION: { text: '使用咨询', color: 'purple' },
};

/** 项目进度条颜色：与状态语义保持一致 */
export const PROJECT_PROGRESS_COLOR: Record<ProjectStatus, string> = {
  OPEN: '#c08532',
  CLAIMED: '#84847e',
  DEVELOPING: '#c08532',
  RELEASED: '#34785c',
  CLOSED: '#a1a19f',
};

/** 反馈状态 -> 中文与颜色 */
export const FEEDBACK_STATUS_MAP: Record<FeedbackStatus, { text: string; color: string }> = {
  OPEN: { text: '待处理', color: 'orange' },
  PROCESSING: { text: '处理中', color: 'blue' },
  RESOLVED: { text: '已解决', color: 'green' },
  CLOSED: { text: '已关闭', color: 'default' },
};

/** 用户状态 -> 中文与颜色 */
export const USER_STATUS_MAP: Record<UserStatus, { text: string; color: string }> = {
  PENDING: { text: '待审核', color: 'orange' },
  ACTIVE: { text: '正常', color: 'green' },
  DISABLED: { text: '已停用', color: 'default' },
};

/** CI 状态 -> 中文与颜色 */
export const CI_STATUS_MAP: Record<string, { text: string; color: string }> = {
  success: { text: 'CI 通过', color: 'success' },
  failure: { text: 'CI 失败', color: 'error' },
  pending: { text: 'CI 运行中', color: 'processing' },
  unknown: { text: 'CI 未知', color: 'default' },
};

/** PR 状态 -> 中文与颜色 */
export function getPullRequestState(state: string, merged: boolean): { text: string; color: string } {
  if (merged) {
    return { text: '已合并', color: 'purple' };
  }
  if (state === 'open') {
    return { text: '待评审', color: 'blue' };
  }
  return { text: '已关闭', color: 'default' };
}

/** 格式化日期时间 */
export function formatTime(value?: string | null): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}
