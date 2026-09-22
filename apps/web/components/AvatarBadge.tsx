'use client';

/**
 * 头像组件
 * 作用：统一渲染同事头像与任务头像，
 *      同事头像为内置人物插画，任务头像为 emoji，均支持图片地址与姓名首字兜底
 */
import PersonAvatar from '@/components/PersonAvatar';
import {
  AvatarPreset,
  TASK_AVATARS,
  USER_AVATARS,
  fallbackAvatarColor,
  findAvatarPreset,
  isImageAvatar,
} from '@/lib/avatars';
import { Avatar, Tooltip } from 'antd';
import { ReactNode } from 'react';

interface AvatarBadgeProps {
  /** 头像取值：预设标识（如 user-01）或图片地址 */
  value?: string | null;
  /** 姓名，用于兜底展示与悬浮提示 */
  name?: string | null;
  /** 头像类型，决定使用哪一组预设 */
  kind?: 'user' | 'task';
  /** 尺寸（像素） */
  size?: number;
  /** 悬浮提示文案，默认使用姓名 */
  tooltip?: ReactNode;
}

/**
 * 渲染单个头像
 * @param props 头像参数
 */
export default function AvatarBadge({
  value,
  name,
  kind = 'user',
  size = 32,
  tooltip,
}: AvatarBadgeProps) {
  const presets: AvatarPreset[] = kind === 'task' ? TASK_AVATARS : USER_AVATARS;
  const preset = findAvatarPreset(presets, value);
  const label = name?.trim() || '同事';

  const node = isImageAvatar(value) ? (
    <Avatar size={size} src={value} alt={label} />
  ) : preset?.person ? (
    // 人物插画：用渐变打底，再叠一层 SVG 半身像
    <Avatar
      size={size}
      alt={label}
      style={{ background: preset.background, overflow: 'hidden' }}
      icon={<PersonAvatar person={preset.person} size={size} />}
    />
  ) : preset?.emoji ? (
    <Avatar
      size={size}
      alt={label}
      style={{ background: preset.background, fontSize: Math.round(size * 0.52) }}
    >
      <span role="img" aria-label={label}>
        {preset.emoji}
      </span>
    </Avatar>
  ) : (
    <Avatar size={size} style={{ background: fallbackAvatarColor(name ?? value), fontSize: Math.round(size * 0.45) }}>
      {label.slice(0, 1)}
    </Avatar>
  );

  const tip = tooltip ?? label;
  return tip ? <Tooltip title={tip}>{node}</Tooltip> : node;
}

/**
 * 头像叠加组：用于「需求方 + 共同需求人」这类多头像场景
 * @param props.items 头像列表
 */
export function AvatarStack({
  items,
  size = 26,
  max = 5,
}: {
  items: Array<{ id: string; name: string; avatarUrl?: string | null; tip?: string }>;
  size?: number;
  max?: number;
}) {
  if (items.length === 0) {
    return <span className="text-muted">-</span>;
  }
  return (
    <Avatar.Group size={size} max={{ count: max, style: { background: '#d9d9d9', color: '#595959' } }}>
      {items.map((item) => (
        <AvatarBadge
          key={item.id}
          value={item.avatarUrl}
          name={item.name}
          size={size}
          tooltip={item.tip ?? item.name}
        />
      ))}
    </Avatar.Group>
  );
}
