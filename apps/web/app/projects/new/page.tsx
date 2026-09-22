'use client';

/**
 * 发布需求页
 * 作用：让不擅长开发的同事用结构化表单把需求描述清楚，便于他人认领
 */
import { api } from '@/lib/api';
import type { Attachment, Paginated, Project } from '@/lib/types';
import AttachmentUploader, { type AttachmentValue } from '@/components/AttachmentUploader';
import ProjectDescriptionEditor from '@/components/ProjectDescriptionEditor';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { Button, Card, Col, Form, Input, Modal, Row, Space, Typography, message } from 'antd';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/** 新需求向导草稿键 */
const DRAFT_KEY = 'aimanager_new_project_draft';

export default function NewProjectPage() {
  const router = useRouter();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [inlineImages, setInlineImages] = useState<Attachment[]>([]);

  /** 恢复未发布的草稿，避免误关页面后重新填写 */
  useEffect(() => {
    const draft = window.localStorage.getItem(DRAFT_KEY);
    if (!draft) {
      return;
    }
    try {
      form.setFieldsValue(JSON.parse(draft));
    } catch {
      window.localStorage.removeItem(DRAFT_KEY);
    }
  }, [form]);

  /** 提交需求 */
  const onFinish = async (values: {
    title: string;
    description: string;
    attachments?: AttachmentValue;
  }) => {
    setSubmitting(true);
    try {
      const similar = await api.get<Paginated<Project>>('/projects', {
        keyword: values.title,
        pageSize: 3,
      });
      if (similar.items.length > 0) {
        const continuePublish = await new Promise<boolean>((resolve) => {
          Modal.confirm({
            title: '发现了可能相似的需求',
            content: (
              <Space direction="vertical">
                <Typography.Text>先看看下面这些需求，可能不需要重复提报：</Typography.Text>
                {similar.items.map((item) => (
                  <Space key={item.id} style={{ width: '100%', justifyContent: 'space-between' }}>
                    <Typography.Text>{item.title}</Typography.Text>
                    <Button
                      type="link"
                      onClick={async () => {
                        await api.post(`/projects/${item.id}/requesters`, {});
                        message.success('已加入共同需求人');
                        resolve(false);
                        router.push(`/projects/${item.id}`);
                      }}
                    >
                      这就是我要的，我也想用
                    </Button>
                  </Space>
                ))}
              </Space>
            ),
            okText: '仍发布新需求',
            cancelText: '先去看看',
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
          });
        });
        if (!continuePublish) {
          return;
        }
      }
      const project = await api.post<Project>('/projects', {
        title: values.title,
        description: values.description,
        // 附件已在表单里逐个上传完成，这里只提交主键，由后端挂到需求上
        imageIds: [
          ...inlineImages.map((item) => item.id),
          ...(values.attachments?.images.map((item) => item.id) ?? []),
        ],
        attachmentIds: values.attachments?.files.map((item) => item.id) ?? [],
      });
      message.success('需求已发布，等待同事认领');
      window.localStorage.removeItem(DRAFT_KEY);
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
          只需要写清楚标题和需求详情，其他信息可以在沟通过程中再补充。
        </Typography.Paragraph>

        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          onValuesChange={(_, values) => window.localStorage.setItem(DRAFT_KEY, JSON.stringify(values))}
          requiredMark
          initialValues={{ attachments: { images: [], files: [] } }}
        >
          <Row gutter={[24, 16]}>
            <Col xs={24} lg={16}>
              <Form.Item
                name="title"
                label="需求标题"
                rules={[{ required: true, min: 4, max: 120, message: '请输入 4-120 个字符的标题' }]}
              >
                <Input size="large" placeholder="例如：内部需求协作平台" maxLength={120} showCount />
              </Form.Item>
              <Form.Item
                name="description"
                label="需求详情"
                rules={[{ required: true, min: 10, max: 5000, message: '请至少写 10 个字，描述你希望解决的问题' }]}
                extra="可以写背景、遇到的问题和期望结果，不需要先写技术方案。"
              >
                <ProjectDescriptionEditor onAttachment={(attachment) => setInlineImages((current) => [...current, attachment])} />
              </Form.Item>
              <Form.Item name="attachments" label="附件（可选）">
                <AttachmentUploader />
              </Form.Item>
            </Col>
            <Col xs={24} lg={8}>
              <Card size="small" title="你写完后，同事会看到" className="wizard-preview">
                <Typography.Text strong>{Form.useWatch('title', form) || '你的需求标题'}</Typography.Text>
                <Typography.Paragraph type="secondary" className="pre-wrap" style={{ marginTop: 8 }}>
                  {Form.useWatch('description', form) || '这里会显示你的需求详情'}
                </Typography.Paragraph>
              </Card>
            </Col>
          </Row>
          <Form.Item style={{ marginBottom: 0, marginTop: 16 }}>
            <Space>
              <Button type="primary" htmlType="submit" size="large" loading={submitting}>
                发布需求
              </Button>
              <Button
                size="large"
                onClick={() => {
                  form.resetFields();
                  setInlineImages([]);
                  window.localStorage.removeItem(DRAFT_KEY);
                }}
              >
                重新开始
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
