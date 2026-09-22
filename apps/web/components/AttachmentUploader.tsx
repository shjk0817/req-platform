'use client';

/**
 * 需求图片与附件上传组件
 * 作用：发布需求时贴图（可在表单里直接预览）与上传附件（发布后可下载）
 * 说明：
 *   1. 采用「先上传拿附件信息、随需求一起提交附件 id」的方式，
 *      因此受控值里保存的是后端返回的 Attachment，而不是浏览器 File；
 *   2. 组件同时兼容 Ant Design Form.Item 的 value / onChange 协议。
 */
import { uploadFile } from '@/lib/api';
import type { Attachment } from '@/lib/types';
import { EyeOutlined, PaperClipOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { Button, Image, List, Modal, Space, Typography, Upload, message } from 'antd';
import type { UploadFile, UploadProps } from 'antd';
import type { UploadChangeParam } from 'antd/es/upload';
import { useState } from 'react';

/** 组件的受控值 */
export interface AttachmentValue {
  images: Attachment[];
  files: Attachment[];
}

/** 组件属性 */
interface Props {
  value?: AttachmentValue;
  onChange?: (value: AttachmentValue) => void;
  disabled?: boolean;
}

/** 把后端附件转换为 Ant Design 上传列表项 */
function toUploadFile(attachment: Attachment): UploadFile {
  return {
    uid: attachment.id,
    name: attachment.name,
    status: 'done',
    url: attachment.url,
    // 用 response 暂存附件信息，便于 onChange 时还原
    response: attachment,
  };
}

/** 从上传列表项还原附件信息（新上传的取 response，已存在的从现有值里找） */
function pickAttachment(file: UploadFile, current: Attachment[]): Attachment | undefined {
  const fromResponse = file.response as Attachment | undefined;
  if (fromResponse && fromResponse.id) {
    return fromResponse;
  }
  return current.find((item) => item.id === file.uid);
}

/** 格式化文件大小 */
export function formatSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export default function AttachmentUploader({ value, onChange, disabled }: Props) {
  const images = value?.images ?? [];
  const files = value?.files ?? [];
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const maxUploadMb = process.env.NEXT_PUBLIC_UPLOAD_MAX_MB ?? '100';

  /** 上传图片 / 附件：统一走 /uploads 接口 */
  const customRequest: UploadProps['customRequest'] = async (options) => {
    try {
      const attachment = await uploadFile(options.file as File);
      options.onSuccess?.(attachment);
      message.success(`${attachment.kind === 'IMAGE' ? '图片' : '附件'}「${attachment.name}」上传成功`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '上传失败';
      options.onError?.(new Error(errorMessage));
      message.error(errorMessage);
    }
  };

  /** 图片列表变化时同步受控值 */
  const handleImageChange = (info: UploadChangeParam<UploadFile>) => {
    const next = info.fileList
      .map((item) => pickAttachment(item, images))
      .filter((item): item is Attachment => Boolean(item));
    onChange?.({ images: next, files });
  };

  /** 附件列表变化时同步受控值 */
  const handleFileChange = (info: UploadChangeParam<UploadFile>) => {
    const next = info.fileList
      .map((item) => pickAttachment(item, files))
      .filter((item): item is Attachment => Boolean(item));
    onChange?.({ images, files: next });
  };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div>
        <Typography.Text type="secondary">需求图片（格式不限，单个不超过 {maxUploadMb}MB，最多 12 张）</Typography.Text>
        <div style={{ marginTop: 8 }}>
          <Upload
            listType="picture-card"
            accept="image/*"
            multiple
            disabled={disabled}
            fileList={images.map(toUploadFile)}
            customRequest={customRequest}
            onChange={handleImageChange}
            onPreview={(file) => setPreviewUrl(file.url ?? null)}
          >
            {images.length >= 12 ? null : (
              <div>
                <PlusOutlined />
                <div style={{ marginTop: 4 }}>添加图片</div>
              </div>
            )}
          </Upload>
        </div>
      </div>

      <div>
        <Typography.Text type="secondary">需求附件（格式不限，单个不超过 {maxUploadMb}MB）</Typography.Text>
        <div style={{ marginTop: 8 }}>
          <Upload
            multiple
            disabled={disabled}
            fileList={files.map(toUploadFile)}
            customRequest={customRequest}
            onChange={handleFileChange}
          >
            <Button icon={<UploadOutlined />}>选择附件</Button>
          </Upload>
        </div>
      </div>

      <Modal
        open={Boolean(previewUrl)}
        footer={null}
        onCancel={() => setPreviewUrl(null)}
        title="图片预览"
        width={720}
      >
        {previewUrl ? <Image src={previewUrl} alt="需求图片预览" style={{ width: '100%' }} /> : null}
      </Modal>
    </Space>
  );
}

/** 需求详情页的附件展示：图片走画廊，附件走下载列表 */
export function AttachmentGallery({
  images = [],
  files = [],
}: {
  images?: Attachment[];
  files?: Attachment[];
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  if (images.length === 0 && files.length === 0) {
    return null;
  }

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {images.length > 0 ? (
        <Image.PreviewGroup>
          <Space wrap size={8}>
            {images.map((item) => (
              <Image
                key={item.id}
                src={item.url}
                alt={item.name}
                width={120}
                height={120}
                style={{ objectFit: 'cover', borderRadius: 4, border: '1px solid #cdcdc9' }}
                preview={{ mask: <EyeOutlined /> }}
              />
            ))}
          </Space>
        </Image.PreviewGroup>
      ) : null}

      {files.length > 0 ? (
        <List
          size="small"
          bordered
          dataSource={files}
          renderItem={(item) => (
            <List.Item
              actions={[
                <a key="download" href={item.downloadUrl} target="_blank" rel="noreferrer">
                  下载
                </a>,
                <Button
                  key="preview"
                  type="link"
                  size="small"
                  onClick={() => setPreviewUrl(item.url)}
                  hidden={!item.mime.startsWith('image/')}
                >
                  预览
                </Button>,
              ]}
            >
              <Space>
                <PaperClipOutlined />
                <span>{item.name}</span>
                <Typography.Text type="secondary">（{formatSize(item.size)}）</Typography.Text>
              </Space>
            </List.Item>
          )}
        />
      ) : null}

      <Modal
        open={Boolean(previewUrl)}
        footer={null}
        onCancel={() => setPreviewUrl(null)}
        title="附件预览"
        width={720}
      >
        {previewUrl ? <Image src={previewUrl} alt="附件预览" style={{ width: '100%' }} /> : null}
      </Modal>
    </Space>
  );
}

/** 空附件占位（供详情页在无附件时使用） */
export function EmptyAttachments() {
  return <Typography.Text type="secondary">该需求未上传图片或附件</Typography.Text>;
}
