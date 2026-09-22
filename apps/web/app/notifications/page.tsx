'use client';

/**
 * 消息通知页
 * 作用：展示与当前用户相关的站内通知，支持跳转、标记已读
 */
import { api } from '@/lib/api';
import { formatTime } from '@/lib/labels';
import type { Notification, Paginated } from '@/lib/types';
import { CheckOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Card, Empty, List, Space, Tag, Typography, message } from 'antd';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

export default function NotificationsPage() {
  const router = useRouter();
  const [data, setData] = useState<Paginated<Notification> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  /** 加载通知列表 */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<Paginated<Notification>>('/notifications', { page, pageSize: 15 }));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 标记单条已读 */
  const markRead = async (item: Notification) => {
    if (!item.read) {
      await api.post(`/notifications/${item.id}/read`).catch(() => undefined);
    }
    if (item.link) {
      router.push(item.link);
    } else {
      await load();
    }
  };

  /** 全部标记已读 */
  const markAllRead = async () => {
    try {
      await api.post('/notifications/read-all');
      message.success('已全部标记为已读');
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
    }
  };

  return (
    <div className="page-container" style={{ maxWidth: 900 }}>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <Typography.Title level={4} style={{ marginBottom: 0 }}>
            消息通知
          </Typography.Title>
          <Typography.Text type="secondary">项目认领、PR 状态、CI 结果与反馈回复都会在这里提醒你</Typography.Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
          <Button icon={<CheckOutlined />} onClick={markAllRead}>
            全部已读
          </Button>
        </Space>
      </Space>

      <Card>
        <List
          loading={loading}
          dataSource={data?.items ?? []}
          locale={{ emptyText: <Empty description="暂无通知" /> }}
          pagination={{
            current: page,
            pageSize: 15,
            total: data?.total ?? 0,
            onChange: (next) => setPage(next),
          }}
          renderItem={(item) => (
            <List.Item
              style={{ cursor: 'pointer', background: item.read ? undefined : '#f6faff' }}
              onClick={() => markRead(item)}
            >
              <List.Item.Meta
                title={
                  <Space>
                    <span>{item.title}</span>
                    {!item.read && <Tag color="blue">未读</Tag>}
                  </Space>
                }
                description={
                  <Space direction="vertical" size={2}>
                    <span>{item.content}</span>
                    <span className="text-muted">{formatTime(item.createdAt)}</span>
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </Card>
    </div>
  );
}
