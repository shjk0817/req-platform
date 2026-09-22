'use client';

/**
 * 项目成果中心
 * 作用：面向普通用户展示 README、使用教程、成果地址与可下载版本
 */
import { AttachmentGallery, EmptyAttachments } from '@/components/AttachmentUploader';
import MarkdownContent, { EmptyDeliverableDocument } from '@/components/MarkdownContent';
import { api } from '@/lib/api';
import { openGitea } from '@/lib/gitea';
import { formatTime } from '@/lib/labels';
import type { ProjectDeliverables } from '@/lib/types';
import {
  ArrowLeftOutlined,
  DownloadOutlined,
  FileTextOutlined,
  GithubOutlined,
  LinkOutlined,
  ReloadOutlined,
  ReadOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, Empty, List, Row, Col, Space, Spin, Tag, Typography, message } from 'antd';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

/** 把字节数转换成普通用户能看懂的文件大小 */
function formatFileSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DeliverablesPage() {
  const params = useParams<{ id: string }>();
  const projectId = params?.id as string;
  const [data, setData] = useState<ProjectDeliverables | null>(null);
  const [loading, setLoading] = useState(true);

  /** 加载成果聚合数据，单项缺失由后端转换为空状态 */
  const load = useCallback(async () => {
    if (!projectId) {
      return;
    }
    setLoading(true);
    try {
      const result = await api.get<ProjectDeliverables>(`/projects/${projectId}/deliverables`);
      setData(result);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '成果加载失败');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="page-container">
        <Card>
          <Spin tip="正在整理成果..." />
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page-container">
        <Empty description="成果暂时无法加载">
          <Button onClick={() => void load()} icon={<ReloadOutlined />}>
            重试
          </Button>
        </Empty>
      </div>
    );
  }

  const { project, readme, tutorial, showcase, downloads } = data;

  return (
    <div className="page-container deliverables-page">
      <Space direction="vertical" size={18} style={{ width: '100%' }}>
        <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space direction="vertical" size={4}>
            <Link href={`/projects/${project.id}`}>
              <Button type="text" icon={<ArrowLeftOutlined />}>
                返回需求详情
              </Button>
            </Link>
            <Typography.Title level={2} style={{ margin: 0 }}>
              {project.repoDisplayName ?? project.title}
            </Typography.Title>
            <Typography.Text type="secondary">
              这里放已经交付的说明、教程、展示地址和下载文件，不需要打开代码也能开始使用。
            </Typography.Text>
          </Space>
          <Space wrap>
            {project.repoUrl && (
              <Button icon={<GithubOutlined />} onClick={() => void openGitea(project.repoUrl)}>
                查看代码库
              </Button>
            )}
            <Button icon={<ReloadOutlined />} onClick={() => void load()}>
              刷新成果
            </Button>
          </Space>
        </Space>

        {!project.repoUrl && (
          <Alert
            type="info"
            showIcon
            message="代码库还没有创建"
            description="负责人创建代码库并发布内容后，README、教程和下载文件会自动出现在这里。"
          />
        )}

        <Row gutter={[16, 16]}>
          <Col xs={24} lg={16}>
            <Card
              title={
                <Space>
                  <FileTextOutlined />
                  <span>项目说明</span>
                </Space>
              }
              extra={
                readme?.htmlUrl ? (
                  <a href={readme.htmlUrl} target="_blank" rel="noreferrer">
                    查看原文
                  </a>
                ) : null
              }
            >
              {readme ? <MarkdownContent content={readme.content} /> : <EmptyDeliverableDocument label="README 项目说明" />}
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card
              title={
                <Space>
                  <ReadOutlined />
                  <span>使用教程</span>
                </Space>
              }
              extra={
                tutorial?.htmlUrl ? (
                  <a href={tutorial.htmlUrl} target="_blank" rel="noreferrer">
                    查看原文
                  </a>
                ) : null
              }
            >
              {tutorial ? (
                <MarkdownContent content={tutorial.content} />
              ) : (
                <EmptyDeliverableDocument label="使用教程（docs/USAGE.md）" />
              )}
            </Card>
          </Col>
        </Row>

        <Card
          title={
            <Space>
              <RocketOutlined />
              <span>成果展示</span>
            </Space>
          }
          extra={showcase.demoUrl ? <Tag color="green">已有展示地址</Tag> : null}
        >
          {showcase.demoUrl ? (
            <Space direction="vertical" size={12}>
              <Typography.Paragraph>
                打开下面的地址即可直接试用成果：
              </Typography.Paragraph>
              <Button
                type="primary"
                icon={<LinkOutlined />}
                href={showcase.demoUrl}
                target="_blank"
                rel="noreferrer"
              >
                打开成果展示
              </Button>
              <Typography.Text className="mono-meta">{showcase.demoUrl}</Typography.Text>
            </Space>
          ) : (
            <Empty description="负责人还没有填写在线展示地址" />
          )}
          {showcase.images.length > 0 ? (
            <div style={{ marginTop: 20 }}>
              <Typography.Title level={5}>成果图片</Typography.Title>
              <AttachmentGallery images={showcase.images} />
            </div>
          ) : (
            <div style={{ marginTop: 16 }}>
              <EmptyAttachments />
            </div>
          )}
          <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
            如果你是需求方或项目负责人，可以在需求详情的“修改需求”里补充展示地址。
          </Typography.Paragraph>
        </Card>

        <Card
          title={
            <Space>
              <DownloadOutlined />
              <span>下载成果</span>
            </Space>
          }
          extra={<Typography.Text type="secondary">文件来自代码库的正式 Release</Typography.Text>}
        >
          {downloads.length > 0 ? (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              {downloads.map((release) => (
                <Card key={release.id} type="inner" title={release.name}>
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    <Space wrap>
                      <Tag>{release.tag}</Tag>
                      {release.publishedAt && (
                        <Typography.Text type="secondary">
                          发布于 {formatTime(release.publishedAt)}
                        </Typography.Text>
                      )}
                      <a href={release.htmlUrl} target="_blank" rel="noreferrer">
                        查看版本说明
                      </a>
                    </Space>
                    <List
                      size="small"
                      dataSource={release.assets}
                      locale={{ emptyText: '这个版本没有可下载文件' }}
                      renderItem={(asset) => (
                        <List.Item
                          actions={[
                            <Button
                              key="download"
                              type="link"
                              icon={<DownloadOutlined />}
                              href={asset.downloadUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              下载
                            </Button>,
                          ]}
                        >
                          <Space>
                            <Typography.Text>{asset.name}</Typography.Text>
                            <Typography.Text type="secondary">{formatFileSize(asset.size)}</Typography.Text>
                          </Space>
                        </List.Item>
                      )}
                    />
                  </Space>
                </Card>
              ))}
            </Space>
          ) : (
            <Empty description="还没有发布可下载版本" />
          )}
        </Card>
      </Space>
    </div>
  );
}
