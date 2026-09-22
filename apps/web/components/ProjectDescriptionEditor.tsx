'use client';

/**
 * 需求详情编辑器
 * 作用：提供普通文本输入和图片插入，图片会以 Markdown 引用写入详情正文。
 */
import { uploadFile } from '@/lib/api';
import type { Attachment } from '@/lib/types';
import { PictureOutlined, UploadOutlined } from '@ant-design/icons';
import { Button, Input, Space, Typography, Upload, message } from 'antd';
import type { UploadProps } from 'antd';

interface Props {
  value?: string;
  onChange?: (value: string) => void;
  onAttachment?: (attachment: Attachment) => void;
}

/** 处理图片上传并把 Markdown 图片引用追加到正文 */
async function uploadInlineImage(
  file: File,
  value: string,
  onChange?: (value: string) => void,
  onAttachment?: (attachment: Attachment) => void,
) {
  const attachment = await uploadFile(file);
  onAttachment?.(attachment);
  const imageMarkdown = `![${attachment.name}](${attachment.url})`;
  onChange?.(`${value.trimEnd()}${value.trim() ? '\n\n' : ''}${imageMarkdown}`);
}

export default function ProjectDescriptionEditor({ value = '', onChange, onAttachment }: Props) {
  const customRequest: UploadProps['customRequest'] = async (options) => {
    try {
      await uploadInlineImage(options.file as File, value, onChange, onAttachment);
      options.onSuccess?.({});
      message.success('图片已插入需求详情');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '图片上传失败';
      options.onError?.(new Error(errorMessage));
      message.error(errorMessage);
    }
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={8}>
      <Input.TextArea
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        rows={10}
        maxLength={5000}
        showCount
        placeholder="说清楚你现在遇到什么问题、希望最后变成什么样。可以直接插入图片，不需要写技术方案。"
      />
      <Space>
        <Upload accept="image/*" showUploadList={false} customRequest={customRequest}>
          <Button icon={<PictureOutlined />}>插入图片</Button>
        </Upload>
        <Typography.Text type="secondary">
          <UploadOutlined /> 支持在正文中插入截图或示意图
        </Typography.Text>
      </Space>
    </Space>
  );
}
