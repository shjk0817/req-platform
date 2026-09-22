'use client';

/**
 * 需求池页面
 * 作用：以卡片形式呈现需求，圆环展示完成进度（状态文字居中于圆环内），
 *      需求方与负责方分开显示头像（支持叠加共同需求人），并可就地「我也需要」
 */
import AvatarBadge, { AvatarStack } from '@/components/AvatarBadge';
import { ProjectStatusTag } from '@/components/StatusTag';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PROJECT_PROGRESS_COLOR, PROJECT_STATUS_MAP, formatTime } from '@/lib/labels';
import type { Paginated, Project, ProjectStatus } from '@/lib/types';
import {
  CheckOutlined,
  FileTextOutlined,
  PlusCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
  TeamOutlined,
  ToolOutlined,
  UserAddOutlined,
} from '@ant-design/icons';
import {
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Pagination,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';

/** 范围筛选选项 */
const SCOPE_OPTIONS = [
  { label: '全部', value: 'all' },
  { label: '等同事接手', value: 'unclaimed' },
  { label: '正在做', value: 'developing' },
  { label: '我参与的', value: 'mine' },
  { label: '我提出的', value: 'created' },
  { label: '我关注的', value: 'requesting' },
];

/** 状态筛选选项 */
const STATUS_OPTIONS: Array<{ label: string; value: ProjectStatus }> = [
  { label: '等同事接手', value: 'OPEN' },
  { label: '已有人接手', value: 'CLAIMED' },
  { label: '正在做', value: 'DEVELOPING' },
  { label: '请你试用', value: 'RELEASED' },
  { label: '已结束', value: 'CLOSED' },
];

/** 需求池内容（独立组件以便读取查询参数） */
function ProjectsContent() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [scope, setScope] = useState<string>(searchParams.get('scope') ?? 'all');
  const [status, setStatus] = useState<ProjectStatus | undefined>(
    (searchParams.get('status') as ProjectStatus | null) ?? undefined,
  );
  const [keyword, setKeyword] = useState(searchParams.get('keyword') ?? '');
  const [debouncedKeyword, setDebouncedKeyword] = useState(searchParams.get('keyword') ?? '');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [data, setData] = useState<Paginated<Project> | null>(null);
  const [loading, setLoading] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  // 认领弹窗
  const [claimTarget, setClaimTarget] = useState<Project | null>(null);
  const [claimForm] = Form.useForm<{ remark?: string; repoName?: string; repoDisplayName?: string }>();
  const [claiming, setClaiming] = useState(false);

  /** 加载需求列表 */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<Paginated<Project>>('/projects', {
        page,
        pageSize,
        status,
        scope: scope === 'all' ? undefined : scope,
        keyword: debouncedKeyword,
      });
      setData(result);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status, scope, debouncedKeyword]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 搜索输入短暂停止后再请求，避免每输入一个字都刷新列表 */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedKeyword(keyword);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  /** 把筛选条件写回地址，刷新或复制链接后仍保留当前视图 */
  useEffect(() => {
    const params = new URLSearchParams();
    if (scope !== 'all') params.set('scope', scope);
    if (status) params.set('status', status);
    if (debouncedKeyword) params.set('keyword', debouncedKeyword);
    if (page > 1) params.set('page', String(page));
    if (pageSize !== 12) params.set('pageSize', String(pageSize));
    const query = params.toString();
    router.replace(query ? `/projects?${query}` : '/projects', { scroll: false });
  }, [debouncedKeyword, page, pageSize, router, scope, status]);

  /** 提交认领 */
  const submitClaim = async () => {
    if (!claimTarget) {
      return;
    }
    const values = await claimForm.validateFields();
    setClaiming(true);
    try {
      await api.post(`/projects/${claimTarget.id}/claim`, values);
      message.success('认领成功，系统已为你创建 Git 仓库');
      setClaimTarget(null);
      claimForm.resetFields();
      router.push(`/projects/${claimTarget.id}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '认领失败');
    } finally {
      setClaiming(false);
    }
  };

  /** 「我也需要」：把自己加为共同需求人 */
  const joinAsRequester = async (project: Project) => {
    setJoiningId(project.id);
    try {
      await api.post(`/projects/${project.id}/requesters`, {});
      message.success('已加入共同需求人，需求方会收到提醒');
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
    } finally {
      setJoiningId(null);
    }
  };

  /** 退出共同需求人 */
  const quitAsRequester = async (project: Project) => {
    if (!user) {
      return;
    }
    setJoiningId(project.id);
    try {
      await api.delete(`/projects/${project.id}/requesters/${user.id}`);
      message.success('已退出共同需求人');
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
    } finally {
      setJoiningId(null);
    }
  };

  return (
    <div className="page-container">
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
        <div>
          <Typography.Title level={4} style={{ marginBottom: 0 }}>
            需求池
          </Typography.Title>
          <Typography.Text type="secondary">
            浏览同事提出的需求，选择你愿意一起推进的项目；有同样的诉求时也可以点击「我也需要」
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

      <Card style={{ marginBottom: 16 }}>
        <Space wrap size={12}>
          <Segmented
            options={SCOPE_OPTIONS}
            value={scope}
            onChange={(value) => {
              setScope(String(value));
              setPage(1);
            }}
          />
          <Select
            allowClear
            placeholder="项目状态"
            style={{ width: 140 }}
            options={STATUS_OPTIONS}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          />
          <Input
            allowClear
            placeholder="搜索标题或描述"
            prefix={<SearchOutlined />}
            style={{ width: 240 }}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </Space>
      </Card>

      <Spin spinning={loading}>
        {(data?.items ?? []).length === 0 ? (
          <Card>
            <Empty
              description={
                data?.total === 0 && scope === 'all' && !debouncedKeyword
                  ? '还没有需求。你可以写下工作里反复手工做的事。'
                  : '没有符合条件的需求，换个筛选条件试试'
              }
            >
              {data?.total === 0 && scope === 'all' && !debouncedKeyword ? (
                <Link href="/projects/new">
                  <Button type="primary">写下一条需求</Button>
                </Link>
              ) : null}
            </Empty>
          </Card>
        ) : (
          <Row gutter={[16, 16]}>
            {(data?.items ?? []).map((project) => {
              const requesters = project.requesters ?? [];
              const isCreator = project.creator?.id === user?.id;
              const joined = requesters.some((item) => item.user.id === user?.id);
              const canClaim = project.status === 'OPEN' && project.ownerId !== user?.id;
              const progress = project.progress ?? 0;

              return (
                <Col key={project.id} xs={24} sm={12} lg={6}>
                  <Card
                    className="project-card project-card-clickable"
                    role="link"
                    tabIndex={0}
                    aria-label={`查看需求：${project.title}`}
                    onClick={() => router.push(`/projects/${project.id}`)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) {
                        return;
                      }
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        router.push(`/projects/${project.id}`);
                      }
                    }}
                    styles={{ body: { padding: 16, height: '100%', display: 'flex', flexDirection: 'column' } }}
                  >
                    <div className="project-card-layer">
                      <Space align="start" size={12} style={{ width: '100%' }}>
                        {/* 圆环进度：状态文字放在圆环中间 */}
                        <Tooltip title={`完成进度 ${progress}%`}>
                          <Progress
                            type="circle"
                            size={78}
                            percent={progress}
                            strokeColor={PROJECT_PROGRESS_COLOR[project.status]}
                            strokeWidth={8}
                            format={() => (
                              <span className="project-ring-text">
                                <span className="project-ring-status">
                                  {PROJECT_STATUS_MAP[project.status]?.text ?? project.status}
                                </span>
                                <span className="project-ring-percent">{progress}%</span>
                              </span>
                            )}
                          />
                        </Tooltip>

                        <Space direction="vertical" size={4} style={{ flex: 1, minWidth: 0 }}>
                          <Space size={6} align="start">
                            <AvatarBadge
                              kind="task"
                              value={project.avatar}
                              name={project.title}
                              size={30}
                              tooltip={`任务头像：${project.title}`}
                            />
                            <Typography.Text strong className="project-card-title">
                              {project.title}
                            </Typography.Text>
                            {project.repoDisplayName && (
                              <Typography.Text className="project-card-alias">
                                代码库：{project.repoDisplayName}
                              </Typography.Text>
                            )}
                          </Space>
                          <Space size={8} wrap className="text-muted">
                            <span>
                              <FileTextOutlined /> 反馈 {project._count?.feedbacks ?? 0}
                            </span>
                            <span>
                              <TeamOutlined /> PR {project._count?.pullReqs ?? 0}
                            </span>
                            {project.attachmentCount ? (
                              <span title="需求带图片或附件">📎 {project.attachmentCount}</span>
                            ) : null}
                          </Space>
                        </Space>
                      </Space>
                    </div>

                    <Typography.Paragraph
                      type="secondary"
                      className="project-card-desc"
                      ellipsis={{ rows: 2 }}
                      style={{ margin: '10px 0 8px' }}
                    >
                      {project.description}
                    </Typography.Paragraph>

                    {project.tags?.length > 0 && (
                      <Space size={4} wrap style={{ marginBottom: 8 }}>
                        {project.tags.slice(0, 4).map((tag) => (
                          <Tag key={tag}>{tag}</Tag>
                        ))}
                      </Space>
                    )}

                    <div className="project-card-meta">
                      <Space direction="vertical" size={6} style={{ width: '100%' }}>
                        <Space size={6} wrap>
                          <span className="text-muted">需求方</span>
                          <AvatarStack
                            size={24}
                            items={[
                              ...(project.creator
                                ? [
                                    {
                                      id: project.creator.id,
                                      name: project.creator.name,
                                      avatarUrl: project.creator.avatarUrl,
                                      tip: `${project.creator.name}（需求方）`,
                                    },
                                  ]
                                : []),
                              ...requesters.map((item) => ({
                                id: item.user.id,
                                name: item.user.name,
                                avatarUrl: item.user.avatarUrl,
                                tip: `${item.user.name}（共同需求人）`,
                              })),
                            ]}
                          />
                          <span>{project.creator?.name ?? '-'}</span>
                          {requesters.length > 0 && (
                            <Tooltip
                              title={`共同需求人：${requesters.map((item) => item.user.name).join('、')}`}
                            >
                              <Tag color="magenta">+{requesters.length} 人也需要</Tag>
                            </Tooltip>
                          )}
                          {!isCreator && user && (
                            <Tooltip title={joined ? '已加入，点击退出' : '我也想用'}>
                              <Button
                                size="small"
                                shape="circle"
                                type={joined ? 'primary' : 'default'}
                                icon={joined ? <CheckOutlined /> : <UserAddOutlined />}
                                loading={joiningId === project.id}
                                aria-label={joined ? '退出共同需求人' : '我也想用'}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void (joined ? quitAsRequester(project) : joinAsRequester(project));
                                }}
                              />
                            </Tooltip>
                          )}
                        </Space>

                        <Space size={6}>
                          <span className="text-muted">负责人</span>
                          {project.owner ? (
                            <>
                              <AvatarBadge
                                value={project.owner.avatarUrl}
                                name={project.owner.name}
                                size={24}
                              />
                              <span>{project.owner.name}</span>
                            </>
                          ) : (
                            <ProjectStatusTag status={project.status} />
                          )}
                          {canClaim && (
                            <Tooltip title="我来做">
                              <Button
                                size="small"
                                shape="circle"
                                type="primary"
                                icon={<ToolOutlined />}
                                aria-label="我来做"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setClaimTarget(project);
                                  claimForm.resetFields();
                                }}
                              />
                            </Tooltip>
                          )}
                        </Space>

                        <span className="text-muted">创建于 {formatTime(project.createdAt)}</span>
                      </Space>
                    </div>

                  </Card>
                </Col>
              );
            })}
          </Row>
        )}
      </Spin>

      <div style={{ marginTop: 16, textAlign: 'right' }}>
        <Pagination
          current={page}
          pageSize={pageSize}
          total={data?.total ?? 0}
          showSizeChanger
          pageSizeOptions={[12, 24, 48]}
          showTotal={(total) => `共 ${total} 条需求`}
          onChange={(nextPage, nextPageSize) => {
            setPage(nextPage);
            setPageSize(nextPageSize);
          }}
        />
      </div>

      <Modal
        open={Boolean(claimTarget)}
        title={`认领需求：${claimTarget?.title ?? ''}`}
        onCancel={() => setClaimTarget(null)}
        onOk={submitClaim}
        confirmLoading={claiming}
        okText="确认认领"
      >
        <Typography.Paragraph type="secondary">
          认领后系统会在 Git 服务中创建项目仓库，并为你开通推送权限。仓库英文名可留空，系统会自动生成。
        </Typography.Paragraph>
        <Form form={claimForm} layout="vertical">
          <Form.Item
            name="repoDisplayName"
            label="仓库中文别名"
            extra="例如“月度报表工具”，会显示在平台卡片和代码库描述中"
          >
            <Input placeholder={claimTarget?.title ?? '给这个成果起个容易认出的名字'} maxLength={120} />
          </Form.Item>
          <Form.Item
            name="repoName"
            label="仓库英文名（可选）"
            extra="只使用字母、数字、连字符、下划线或点号，例如 monthly-report-tool"
            rules={[
              {
                pattern: /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
                message: '只能使用字母、数字、连字符、下划线或点号，且必须以字母或数字开头',
              },
            ]}
          >
            <Input placeholder="留空则自动生成" maxLength={100} />
          </Form.Item>
          <Form.Item name="remark" label="认领留言">
            <Input.TextArea rows={3} maxLength={500} placeholder="可填写实现思路或预计完成时间" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

/** 页面出口 */
export default function ProjectsPage() {
  return (
    <Suspense fallback={null}>
      <ProjectsContent />
    </Suspense>
  );
}
