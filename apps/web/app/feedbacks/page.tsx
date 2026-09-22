'use client';

/**
 * 反馈中心
 * 作用：集中查看我提交的反馈与需要我处理的反馈，并支持讨论与状态流转
 */
import AvatarBadge from '@/components/AvatarBadge';
import { FeedbackStatusTag, FeedbackTypeTag } from '@/components/StatusTag';
import { api } from '@/lib/api';
import { openGitea } from '@/lib/gitea';
import { formatTime } from '@/lib/labels';
import type { Feedback, FeedbackStatus, Paginated } from '@/lib/types';
import { PlusOutlined } from '@ant-design/icons';
import {
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  List,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

/** 状态筛选选项 */
const STATUS_OPTIONS: Array<{ label: string; value: FeedbackStatus }> = [
  { label: '待处理', value: 'OPEN' },
  { label: '处理中', value: 'PROCESSING' },
  { label: '已解决', value: 'RESOLVED' },
  { label: '已关闭', value: 'CLOSED' },
];

export default function FeedbacksPage() {
  const [scope, setScope] = useState<'mine' | 'assigned' | 'all'>('mine');
  const [status, setStatus] = useState<FeedbackStatus | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<Feedback> | null>(null);
  const [loading, setLoading] = useState(false);

  const [active, setActive] = useState<Feedback | null>(null);
  const [comment, setComment] = useState('');
  const [commentLoading, setCommentLoading] = useState(false);

  /** 加载反馈列表 */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<Paginated<Feedback>>('/feedbacks', {
        page,
        pageSize: 10,
        status,
        scope: scope === 'all' ? undefined : scope,
      });
      setData(result);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, status, scope]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * 支持从首页统计卡片带条件进来（例如 ?scope=all&status=OPEN）
   * 说明：直接用 window.location 读取，避免 useSearchParams 触发预渲染的 Suspense 限制
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const statusParam = params.get('status') as FeedbackStatus | null;
    const scopeParam = params.get('scope');
    if (statusParam) {
      setStatus(statusParam);
    }
    if (scopeParam === 'mine' || scopeParam === 'assigned' || scopeParam === 'all') {
      setScope(scopeParam);
    }
  }, []);

  /** 打开反馈详情 */
  const open = async (id: string) => {
    try {
      setActive(await api.get<Feedback>(`/feedbacks/${id}`));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载失败');
    }
  };

  /** 追加回复 */
  const submitComment = async () => {
    if (!active || !comment.trim()) {
      return;
    }
    setCommentLoading(true);
    try {
      setActive(await api.post<Feedback>(`/feedbacks/${active.id}/comments`, { content: comment }));
      setComment('');
      message.success('回复成功，已同步到仓库 Issue');
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '回复失败');
    } finally {
      setCommentLoading(false);
    }
  };

  /** 变更反馈状态 */
  const changeStatus = async (next: FeedbackStatus) => {
    if (!active) {
      return;
    }
    try {
      setActive(await api.patch<Feedback>(`/feedbacks/${active.id}/status`, { status: next }));
      message.success('状态已更新');
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
    }
  };

  return (
    <div className="page-container">
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
        <div>
          <Typography.Title level={4} style={{ marginBottom: 0 }}>
            反馈中心
          </Typography.Title>
          <Typography.Text type="secondary">
            使用过程中发现的问题或改进建议，都会同步到对应项目的仓库 Issue
          </Typography.Text>
        </div>
      </Space>

      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <Segmented
            value={scope}
            onChange={(value) => {
              setScope(value as typeof scope);
              setPage(1);
            }}
            options={[
              { label: '我提交的', value: 'mine' },
              { label: '待我处理', value: 'assigned' },
              { label: '全部', value: 'all' },
            ]}
          />
          <Select
            allowClear
            placeholder="反馈状态"
            style={{ width: 140 }}
            options={STATUS_OPTIONS}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          />
        </Space>
      </Card>

      <Table<Feedback>
        rowKey="id"
        loading={loading}
        dataSource={data?.items ?? []}
        pagination={{
          current: page,
          pageSize: 10,
          total: data?.total ?? 0,
          showTotal: (total) => `共 ${total} 条反馈`,
          onChange: (next) => setPage(next),
        }}
        columns={[
          {
            title: '反馈标题',
            dataIndex: 'title',
            render: (title: string, record) => (
              <Space direction="vertical" size={2}>
                <a onClick={() => open(record.id)}>{title}</a>
                <span className="text-muted">
                  {record.content.length > 60 ? `${record.content.slice(0, 60)}...` : record.content}
                </span>
              </Space>
            ),
          },
          {
            title: '所属项目',
            width: 200,
            render: (_, record) =>
              record.project ? (
                <Link href={`/projects/${record.project.id}?tab=feedback`}>{record.project.title}</Link>
              ) : (
                '-'
              ),
          },
          { title: '类型', width: 110, render: (_, record) => <FeedbackTypeTag type={record.type} /> },
          { title: '状态', width: 100, render: (_, record) => <FeedbackStatusTag status={record.status} /> },
          {
            title: 'Issue',
            width: 100,
            render: (_, record) =>
              record.issueNumber ? (
                <Typography.Link onClick={() => void openGitea(record.issueUrl)}>
                  #{record.issueNumber}
                </Typography.Link>
              ) : (
                <span className="text-muted">未同步</span>
              ),
          },
          {
            title: '提交人',
            width: 150,
            render: (_, record) => (
              <Space size={6}>
                <AvatarBadge value={record.user?.avatarUrl} name={record.user?.name} size={22} />
                <span>{record.user?.name ?? '-'}</span>
              </Space>
            ),
          },
          {
            title: '提交时间',
            dataIndex: 'createdAt',
            width: 150,
            render: (value: string) => <span className="text-muted">{formatTime(value)}</span>,
          },
          {
            title: '操作',
            width: 100,
            render: (_, record) => (
              <Button type="link" size="small" onClick={() => open(record.id)}>
                查看讨论
              </Button>
            ),
          },
        ]}
      />

      <Drawer
        width={560}
        open={Boolean(active)}
        onClose={() => setActive(null)}
        title={active?.title}
        extra={
          <Select
            size="small"
            style={{ width: 120 }}
            value={active?.status}
            options={STATUS_OPTIONS}
            onChange={changeStatus}
          />
        }
      >
        {active && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Space wrap>
              <FeedbackTypeTag type={active.type} />
              <FeedbackStatusTag status={active.status} />
              {active.project && (
                <Link href={`/projects/${active.project.id}`}>
                  <Tag color="geekblue">{active.project.title}</Tag>
                </Link>
              )}
              {active.issueNumber && (
                <span
                  style={{ cursor: 'pointer' }}
                  onClick={() => void openGitea(active.issueUrl)}
                >
                  <Tag color="blue">Issue #{active.issueNumber}</Tag>
                </span>
              )}
            </Space>

            <Card size="small" title={`${active.user?.name ?? '提交人'} 的描述`}>
              <Typography.Paragraph className="pre-wrap" style={{ marginBottom: 0 }}>
                {active.content}
              </Typography.Paragraph>
            </Card>

            <div>
              <Typography.Text strong>讨论记录</Typography.Text>
              <List
                style={{ marginTop: 8 }}
                dataSource={active.comments ?? []}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无讨论" /> }}
                renderItem={(item) => (
                  <List.Item>
                    <List.Item.Meta
                      title={
                        <Space>
                          <AvatarBadge value={item.user.avatarUrl} name={item.user.name} size={22} />
                          <span>{item.user.name}</span>
                          <span className="text-muted">{formatTime(item.createdAt)}</span>
                        </Space>
                      }
                      description={<span className="pre-wrap">{item.content}</span>}
                    />
                  </List.Item>
                )}
              />
            </div>

            <Input.TextArea
              rows={3}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="输入回复内容，会同步到仓库 Issue"
              maxLength={2000}
            />
            <Button type="primary" icon={<PlusOutlined />} loading={commentLoading} onClick={submitComment}>
              发送回复
            </Button>
          </Space>
        )}
      </Drawer>
    </div>
  );
}
