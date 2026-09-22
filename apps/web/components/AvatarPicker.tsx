'use client';

/**
 * 头像选择器
 * 作用：默认只展示当前头像，点击「更换头像」后在悬浮面板里挑选，
 *      避免把十几个头像一次性铺在页面上占满一屏；可直接嵌入 Ant Design Form
 */
import PersonAvatar from '@/components/PersonAvatar';
import { AvatarPreset } from '@/lib/avatars';
import { BgColorsOutlined, CheckOutlined } from '@ant-design/icons';
import { Button, Popover, Space, Tooltip, Typography } from 'antd';
import { useState } from 'react';

interface AvatarPickerProps {
  /** 可选头像集合 */
  presets: AvatarPreset[];
  /** 当前选中值 */
  value?: string | null;
  /** 选中回调（配合 Form 使用时由表单注入） */
  onChange?: (value: string) => void;
  /** 单个头像尺寸 */
  size?: number;
  /** 同事姓名，用于预览时的兜底展示 */
  name?: string | null;
}

/**
 * 渲染头像选择器
 * @param props 选择器参数
 */
export default function AvatarPicker({
  presets,
  value,
  onChange,
  size = 44,
  name,
}: AvatarPickerProps) {
  const [open, setOpen] = useState(false);
  const current = presets.find((preset) => preset.key === value);

  /** 单个头像内容：人物插画或 emoji */
  const renderPreset = (preset: AvatarPreset, boxSize: number) =>
    preset.person ? (
      <PersonAvatar person={preset.person} size={boxSize} />
    ) : (
      <span style={{ fontSize: Math.round(boxSize * 0.5) }} role="img" aria-hidden="true">
        {preset.emoji}
      </span>
    );

  /** 面板内容：可滚动的头像网格 */
  const panel = (
    <div className="avatar-picker">
      {presets.map((preset) => {
        const active = preset.key === value;
        return (
          <Tooltip key={preset.key} title={active ? '当前头像' : '选用这个头像'}>
            <button
              type="button"
              className={`avatar-picker-item${active ? ' is-active' : ''}`}
              style={{ background: preset.background, width: size, height: size }}
              onClick={() => {
                onChange?.(preset.key);
                setOpen(false);
              }}
              aria-label={`头像 ${preset.key}`}
              aria-pressed={active}
            >
              {renderPreset(preset, size)}
              {active && <CheckOutlined className="avatar-picker-check" />}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );

  return (
    <Space size={12} align="center">
      {/* 当前头像预览 */}
      <span
        className="avatar-picker-current"
        style={{
          background: current?.background ?? '#f0f0f0',
          width: size + 12,
          height: size + 12,
        }}
      >
        {current?.person ? (
          <PersonAvatar person={current.person} size={size + 12} />
        ) : current?.emoji ? (
          <span style={{ fontSize: Math.round(size * 0.55) }} role="img" aria-hidden="true">
            {current.emoji}
          </span>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {(name ?? '').slice(0, 1) || '默认'}
          </Typography.Text>
        )}
      </span>

      <Space direction="vertical" size={0}>
        <Popover
          open={open}
          onOpenChange={setOpen}
          trigger="click"
          placement="bottomLeft"
          content={panel}
        >
          <Button icon={<BgColorsOutlined />}>{current ? '更换头像' : '选择头像'}</Button>
        </Popover>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {current ? '已选择预设头像，可点击更换' : '未选择时展示姓名首字'}
        </Typography.Text>
      </Space>
    </Space>
  );
}
