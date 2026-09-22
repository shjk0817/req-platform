'use client';

/**
 * 头像选择器
 * 作用：在设置头像弹窗中分开展示自定义上传与预设头像，
 *      让新手能明确区分“上传自己的图片”和“选择系统头像”。
 */
import PersonAvatar from '@/components/PersonAvatar';
import { uploadAvatar } from '@/lib/api';
import { AvatarPreset } from '@/lib/avatars';
import { CheckOutlined, UploadOutlined } from '@ant-design/icons';
import { Space, Spin, Tabs, Tooltip, Typography, message } from 'antd';
import type { DragEvent } from 'react';
import { useRef, useState } from 'react';

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
  const current = presets.find((preset) => preset.key === value);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  /** 单个头像内容：人物插画或 emoji */
  const renderPreset = (preset: AvatarPreset, boxSize: number) =>
    preset.person ? (
      <PersonAvatar person={preset.person} size={boxSize} />
    ) : (
      <span style={{ fontSize: Math.round(boxSize * 0.5) }} role="img" aria-hidden="true">
        {preset.emoji}
      </span>
    );

  /** 预设头像网格 */
  const presetPanel = (
    <div className="avatar-picker" style={{ maxWidth: 420, maxHeight: 300 }}>
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

  /** 上传自定义头像并写回表单 */
  const handleUpload = async (file?: File) => {
    if (!file) {
      return;
    }
    setUploading(true);
    try {
      const result = await uploadAvatar<{ avatarUrl?: string | null }>(file);
      if (result.avatarUrl) {
        onChange?.(result.avatarUrl);
      }
      message.success('自定义头像已上传');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '头像上传失败');
    } finally {
      setUploading(false);
    }
  };

  /** 支持点击与拖拽两种方式选择头像图片 */
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    void handleUpload(event.dataTransfer.files?.[0]);
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {/* 当前头像预览 */}
      <Space direction="vertical" align="center" style={{ width: '100%' }}>
        <span
          className="avatar-picker-current"
          style={{
            background: current?.background ?? '#f0f0f0',
            width: size + 28,
            height: size + 28,
          }}
        >
          {current?.person ? (
            <PersonAvatar person={current.person} size={size + 28} />
          ) : current?.emoji ? (
            <span style={{ fontSize: Math.round(size * 0.65) }} role="img" aria-hidden="true">
              {current.emoji}
            </span>
          ) : value ? (
            <img
              src={value}
              alt={name ?? '自定义头像'}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {(name ?? '').slice(0, 1) || '默认'}
            </Typography.Text>
          )}
        </span>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {value ? '当前头像' : '未选择时展示姓名首字'}
        </Typography.Text>
      </Space>

      <Tabs
        items={[
          {
            key: 'upload',
            label: '上传图片',
            children: (
              <Space direction="vertical" align="center" style={{ width: '100%' }}>
                <Typography.Text type="secondary">
                  支持图片格式，单个不超过 {process.env.NEXT_PUBLIC_AVATAR_MAX_MB ?? '5'}MB
                </Typography.Text>
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(event) => {
                    void handleUpload(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
                <div
                  className="avatar-upload-dropzone"
                  role="button"
                  tabIndex={0}
                  onClick={() => inputRef.current?.click()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      inputRef.current?.click();
                    }
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleDrop}
                >
                  {uploading ? <Spin size="small" /> : <UploadOutlined className="avatar-upload-icon" />}
                  <Typography.Text strong>
                    {uploading ? '正在上传头像…' : '点击或拖拽上传头像'}
                  </Typography.Text>
                  <Typography.Text type="secondary">上传后会自动裁剪为正方形</Typography.Text>
                </div>
              </Space>
            ),
          },
          {
            key: 'preset',
            label: '选择预设',
            children: presetPanel,
          },
        ]}
      />
    </Space>
  );
}
