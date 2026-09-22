'use client';

/**
 * 工作台首页
 * 作用：展示平台整体数据与当前用户的待办事项，并给出快捷入口
 */
import { ProjectStatusTag } from '@/components/StatusTag';
import AvatarBadge from '@/components/AvatarBadge';
import Heatmap from '@/components/Heatmap';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatTime } from '@/lib/labels';
import type { HeatmapData, MyTodos, PlatformStats, Project, ProjectStatus } from '@/lib/types';
import {
  AppstoreOutlined,
  BugOutlined,
  CheckCircleOutlined,
  PlusCircleOutlined,
  ReloadOutlined,
  RocketOutlined,
  TeamOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  List,
  Row,
  Space,
  Spin,
  Statistic,
  Tag,
  Typography,
  message,
} from 'antd';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

export default function DashboardPage() {
  const { user, isAdmin } = useAuth();
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [todos, setTodos] = useState<MyTodos | null>(null);
  const [recent, setRecent] = useState<Project[]>([]);
  const [heatmap, setHeatmap] = useState<HeatmapData | null>(null);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  /** 加载工作台数据 */
  const load = useCallback(async () => {
    setLoading(true);
    setHeatmapLoading(true);
    try {
      const [statsData, todosData, recentData] = await Promise.all([
        api.get<PlatformStats>('/projects/stats'),
        api.get<MyTodos>('/projects/todos'),
        api.get<{ items: Project[] }>('/projects', { pageSize: 5, sortBy: 'createdAt', order: 'desc' }),
      ]);
      setStats(statsData);
      setTodos(todosData);
      setRecent(recentData.items);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载失败');
    } finally {
      setLoading(false);
    }

    // 全平台协作热力图单独加载，避免统计接口拖慢主数据
    try {
      const heatmapData = await api.get<HeatmapData>('/stats/heatmap', { months: 12 });
      setHeatmap(heatmapData);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '热力图加载失败');
    } finally {
      setHeatmapLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSync = async (projectId: string) => {
    try {
      const result = await api.post<{ message: string; synced: number }>(`/projects/${projectId}/sync`);
      message.success(`${result.message}，共同步 ${result.synced} 个 PR`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '同步失败');
    }
  };

  return (
    <div className="page-container">
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <Typography.Title level={4} style={{ marginBottom: 0 }}>
            你好，{user?.name}
          </Typography.Title>
          <Typography.Text type="secondary">
            在这里发布需求、认领项目，并跟进协作开发进度
          </Typography.Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
          <Link href="/projects/new">
            <Button type="primary" icon={<PlusCircleOutlined />}>
              发布需求
            </Button>
          </Link>
        </Space>
      </Space>

      {isAdmin && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="管理员提示"
          description="你可以在「用户审核」中处理注册申请；审核通过后系统会自动为该同事开通 Git 账号。"
          action={
            <Link href="/admin/users">
              <Button size="small">前往处理</Button>
            </Link>
          }
        />
      )}

      {todos?.nextAction && (
        <Card
          className="next-action-card"
          style={{ marginBottom: 16 }}
          title="现在该做什么"
          extra={<Tag color="blue">只做这一件</Tag>}
        >
          <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
            <div>
              <Typography.Title level={5} style={{ margin: 0 }}>
                {todos.nextAction.title}
              </Typography.Title>
              <Typography.Text type="secondary">{todos.nextAction.reason}</Typography.Text>
            </div>
            <Link href={todos.nextAction.href}>
              <Button type="primary">{todos.nextAction.primaryLabel}</Button>
            </Link>
          </Space>
        </Card>
      )}

      <Spin spinning={loading}>
        <Row gutter={[16, 16]}>
          <Col xs={12} md={6}>
            <Link href="/projects" className="stat-card-link">
              <Card hoverable>
                <Statistic title="需求总数" value={stats?.total ?? 0} prefix={<AppstoreOutlined />} />
                <span className="stat-card-hint">查看全部需求</span>
              </Card>
            </Link>
          </Col>
          <Col xs={12} md={6}>
            <Link href="/projects?scope=unclaimed" className="stat-card-link">
              <Card hoverable>
                <Statistic
                  title="等同事接手"
                  value={stats?.open ?? 0}
                  valueStyle={{ color: '#fa8c16' }}
                  prefix={<RocketOutlined />}
                />
                <span className="stat-card-hint">去认领一个</span>
              </Card>
            </Link>
          </Col>
          <Col xs={12} md={6}>
            <Link href="/projects?scope=developing" className="stat-card-link">
              <Card hoverable>
                <Statistic
                  title="正在做"
                  value={(stats?.claimed ?? 0) + (stats?.developing ?? 0)}
                  valueStyle={{ color: '#34785c' }}
                  prefix={<ToolOutlined />}
                />
                <span className="stat-card-hint">查看开发进度</span>
              </Card>
            </Link>
          </Col>
          <Col xs={12} md={6}>
            <Link href="/feedbacks?scope=all&status=OPEN" className="stat-card-link">
              <Card hoverable>
                <Statistic
                  title="待处理反馈"
                  value={stats?.feedbackOpen ?? 0}
                  valueStyle={{ color: '#ff4d4f' }}
                  prefix={<BugOutlined />}
                />
                <span className="stat-card-hint">去处理反馈</span>
              </Card>
            </Link>
          </Col>
        </Row>

        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} lg={8}>
            <Card
              title="我在做的项目"
              extra={
                <Link href="/projects?scope=mine">
                  <Typography.Link>查看全部</Typography.Link>
                </Link>
              }
              style={{ minHeight: 320 }}
            >
              <List
                dataSource={todos?.owning ?? []}
                locale={{ emptyText: <Empty description="暂无进行中的项目，去需求池认领一个吧" /> }}
                renderItem={(item) => (
                  <List.Item
                    actions={[
                      <Button key="sync" type="link" size="small" onClick={() => handleSync(item.id)}>
                        同步 PR
                      </Button>,
                    ]}
                  >
                    <List.Item.Meta
                      title={<Link href={`/projects/${item.id}`}>{item.title}</Link>}
                      description={
                        <Space>
                          <ProjectStatusTag status={item.status as ProjectStatus} />
                          <span className="text-muted">更新于 {formatTime(item.updatedAt)}</span>
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            </Card>
          </Col>

          <Col xs={24} lg={8}>
            <Card
              title="我提出的需求"
              extra={
                <Link href="/projects?scope=created">
                  <Typography.Link>查看全部</Typography.Link>
                </Link>
              }
              style={{ minHeight: 320 }}
            >
              <List
                dataSource={todos?.created ?? []}
                locale={{ emptyText: <Empty description="还没有提出需求" /> }}
                renderItem={(item) => (
                  <List.Item>
                    <List.Item.Meta
                      title={<Link href={`/projects/${item.id}`}>{item.title}</Link>}
                      description={
                        <Space>
                          <ProjectStatusTag status={item.status as ProjectStatus} />
                          <span className="text-muted">更新于 {formatTime(item.updatedAt)}</span>
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            </Card>
          </Col>

          <Col xs={24} lg={8}>
            <Card title="我的待办" style={{ minHeight: 320 }}>
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Link href="/feedbacks?scope=assigned&status=OPEN">
                  <Card size="small" type="inner" title="待处理反馈" hoverable>
                    <Space>
                      <BugOutlined />
                      <Typography.Text>{todos?.pendingFeedbacks ?? 0} 条反馈等你跟进</Typography.Text>
                    </Space>
                  </Card>
                </Link>
                <Link href="/projects?scope=mine">
                  <Card size="small" type="inner" title="正在做的修改" hoverable>
                    <Space>
                      <CheckCircleOutlined />
                      <Typography.Text>{todos?.openPullRequests ?? 0} 份修改还在等待确认</Typography.Text>
                    </Space>
                  </Card>
                </Link>
                <Card size="small" type="inner" title="团队协作">
                  <Space>
                    <TeamOutlined />
                    <Typography.Text>平台共有 {stats?.users ?? 0} 位同事已开通账号</Typography.Text>
                  </Space>
                </Card>
              </Space>
            </Card>
          </Col>
        </Row>

        <Card
          title="平台协作热力图"
          extra={
            <Space size={12}>
              <span className="text-muted">近 12 个月 · 全平台</span>
              <Link href="/profile">
                <Typography.Link>查看我的热力图</Typography.Link>
              </Link>
            </Space>
          }
          style={{ marginTop: 16 }}
        >
          <Heatmap data={heatmap} loading={heatmapLoading} />
        </Card>

        <Card
          title="最新需求"
          style={{ marginTop: 16 }}
          extra={
            <Link href="/projects">
              <Typography.Link>进入需求池</Typography.Link>
            </Link>
          }
        >
          <List
            dataSource={recent}
            locale={{ emptyText: <Empty description="暂无需求" /> }}
            renderItem={(item) => (
              <List.Item>
                <List.Item.Meta
                  avatar={<AvatarBadge kind="task" value={item.avatar} name={item.title} size={40} />}
                  title={
                    <Space>
                      <Link href={`/projects/${item.id}`}>{item.title}</Link>
                      <ProjectStatusTag status={item.status} />
                    </Space>
                  }
                  description={
                    <Space size={12} wrap>
                      <Space size={6}>
                        <AvatarBadge value={item.creator?.avatarUrl} name={item.creator?.name} size={20} />
                        <span className="text-muted">需求方：{item.creator?.name ?? '-'}</span>
                      </Space>
                      <Space size={6}>
                        {item.owner ? (
                          <AvatarBadge value={item.owner.avatarUrl} name={item.owner.name} size={20} />
                        ) : null}
                        <span className="text-muted">负责人：{item.owner?.name ?? '待认领'}</span>
                      </Space>
                      {(item.requesters?.length ?? 0) > 0 && (
                        <span className="text-muted">共同需求人 {(item.requesters ?? []).length} 人</span>
                      )}
                      <span className="text-muted">提交于 {formatTime(item.createdAt)}</span>
                      {item.tags?.slice(0, 4).map((tag) => (
                        <Tag key={tag}>{tag}</Tag>
                      ))}
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        </Card>
      </Spin>
    </div>
  );
}
