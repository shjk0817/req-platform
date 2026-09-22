'use client';

/**
 * 状态标签组件
 * 作用：统一渲染项目、反馈、CI 等状态的中文标签与颜色
 */
import {
  CI_STATUS_MAP,
  FEEDBACK_STATUS_MAP,
  FEEDBACK_TYPE_MAP,
  PROJECT_STATUS_MAP,
  USER_STATUS_MAP,
  getPullRequestState,
} from '@/lib/labels';
import type { FeedbackStatus, FeedbackType, ProjectStatus, UserStatus } from '@/lib/types';
import { Tag } from 'antd';

/** 项目状态标签 */
export function ProjectStatusTag({ status }: { status: ProjectStatus }) {
  const item = PROJECT_STATUS_MAP[status] ?? { text: status, color: 'default' };
  return <Tag color={item.color}>{item.text}</Tag>;
}

/** 反馈状态标签 */
export function FeedbackStatusTag({ status }: { status: FeedbackStatus }) {
  const item = FEEDBACK_STATUS_MAP[status] ?? { text: status, color: 'default' };
  return <Tag color={item.color}>{item.text}</Tag>;
}

/** 反馈类型标签 */
export function FeedbackTypeTag({ type }: { type: FeedbackType }) {
  const item = FEEDBACK_TYPE_MAP[type] ?? { text: type, color: 'default' };
  return <Tag color={item.color}>{item.text}</Tag>;
}

/** 用户状态标签 */
export function UserStatusTag({ status }: { status: UserStatus }) {
  const item = USER_STATUS_MAP[status] ?? { text: status, color: 'default' };
  return <Tag color={item.color}>{item.text}</Tag>;
}

/** CI 状态标签 */
export function CiStatusTag({ status }: { status: string }) {
  const item = CI_STATUS_MAP[status] ?? CI_STATUS_MAP.unknown;
  return <Tag color={item.color}>{item.text}</Tag>;
}

/** Pull Request 状态标签 */
export function PullRequestStateTag({ state, merged }: { state: string; merged: boolean }) {
  const item = getPullRequestState(state, merged);
  return <Tag color={item.color}>{item.text}</Tag>;
}
