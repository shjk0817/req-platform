'use client';

/**
 * 发布需求页
 * 作用：让不擅长开发的同事用结构化表单把需求描述清楚，便于他人认领
 */
import { api } from '@/lib/api';
import { TASK_AVATARS, pickTaskAvatar } from '@/lib/avatars';
import type { Project } from '@/lib/types';
import AttachmentUploader, { type AttachmentValue } from '@/components/AttachmentUploader';
import AvatarPicker from '@/components/AvatarPicker';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { Alert, Button, Card, DatePicker, Form, Input, Select, Space, Typography, message } from 'antd';
import dayjs from 'dayjs';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** 常用需求标签候选 */
const TAG_OPTIONS = [
  '报表',
  '自动化',
  '数据处理',
  '前端页面',
  '内部工具',
  '接口对接',
  '流程审批',
  '数据看板',
  '文件处理',
  '消息通知',
  '移动端',
  '性能优化',
];

export default function NewProjectPage() {
  const router = useRouter();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  /** 提交需求 */
  const onFinish = async (values: {
    title: string;
    description: string;
    acceptanceCriteria?: string;
    tags?: string[];
    avatar?: string;
    expectedAt?: dayjs.Dayjs;
    attachments?: AttachmentValue;
  }) => {
    setSubmitting(true);
    try {
      const project = await api.post<Project>('/projects', {
        title: values.title,
        description: values.description,
        acceptanceCriteria: values.acceptanceCriteria,
        tags: values.tags ?? [],
        avatar: values.avatar,
        expectedAt: values.expectedAt ? values.expectedAt.toISOString() : undefined,
        // 附件已在表单里逐个上传完成，这里只提交主键，由后端挂到需求上
        imageIds: values.attachments?.images.map((item) => item.id) ?? [],
        attachmentIds: values.attachments?.files.map((item) => item.id) ?? [],
      });
      message.success('需求已发布，等待同事认领');
      router.push(`/projects/${project.id}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '发布失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-container" style={{ maxWidth: 900 }}>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => router.back()}>
          返回
        </Button>
      </Space>

      <Card>
        <Typography.Title level={4}>发布需求</Typography.Title>
        <Typography.Paragraph type="secondary">
          需求描述越具体，越容易被有能力的同事认领。建议写清「现状、痛点、期望效果、验收标准」。
        </Typography.Paragraph>

        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 20 }}
          message="写需求的小技巧"
          description="补充当前是怎么做的、涉及哪些人、期望什么时候能用上，以及怎么算做完（验收标准）。"
        />

        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          requiredMark
          initialValues={{ avatar: pickTaskAvatar(Date.now()) }}
        >
          <Form.Item name="avatar" label="任务头像" extra="选一个头像，方便在需求池里一眼认出这个需求">
            <AvatarPicker presets={TASK_AVATARS} />
          </Form.Item>

          <Form.Item
            name="title"
            label="需求标题"
            rules={[{ required: true, min: 4, max: 120, message: '请输入 4-120 个字符的标题' }]}
          >
            <Input size="large" placeholder="例如：生产日报自动生成并推送" maxLength={120} showCount />
          </Form.Item>

          <Form.Item
            name="description"
            label="需求详细描述"
            rules={[{ required: true, min: 10, max: 5000, message: '请填写至少 10 个字符的描述' }]}
            extra="建议包含：需求背景、目前的做法与痛点、期望的最终效果、涉及的使用人群"
          >
            <Input.TextArea rows={10} maxLength={5000} showCount placeholder="请尽量详细地描述你的需求" />
          </Form.Item>

          <Form.Item
            name="acceptanceCriteria"
            label="验收标准"
            extra="满足哪些条件就认为这个需求完成了，例如「能导出最近 30 天的数据且金额与系统一致」"
          >
            <Input.TextArea rows={4} maxLength={2000} showCount placeholder="逐条列出可验证的验收条件" />
          </Form.Item>

          <Form.Item name="tags" label="需求标签" extra="标签会用于给方向匹配的同事推送提醒">
            <Select
              mode="tags"
              size="large"
              placeholder="选择或输入标签"
              options={TAG_OPTIONS.map((item) => ({ label: item, value: item }))}
            />
          </Form.Item>

          <Form.Item name="expectedAt" label="期望交付时间">
            <DatePicker size="large" style={{ width: '100%' }} placeholder="选择期望完成日期（选填）" />
          </Form.Item>

          <Form.Item
            name="attachments"
            label="需求图片与附件"
            extra="图片会展示在需求详情页的图廊中，附件供参与开发的同事下载查看"
            initialValue={{ images: [], files: [] }}
          >
            <AttachmentUploader />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Space>
              <Button type="primary" htmlType="submit" size="large" loading={submitting}>
                发布需求
              </Button>
              <Button size="large" onClick={() => form.resetFields()}>
                重置
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
