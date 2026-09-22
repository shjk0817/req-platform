'use client';

/**
 * 项目详情页
 * 作用：展示需求详情、协作开发（PR/CI）、反馈闭环，并提供认领、
 *      成员管理、仓库创建与状态流转等操作入口
 */
import AvatarBadge, { AvatarStack } from '@/components/AvatarBadge';
import { AttachmentGallery, EmptyAttachments } from '@/components/AttachmentUploader';
import {
  CiStatusTag,
  FeedbackStatusTag,
  FeedbackTypeTag,
  ProjectStatusTag,
  PullRequestStateTag,
} from '@/components/StatusTag';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { openGitea } from '@/lib/gitea';
import { PROJECT_PROGRESS_COLOR, formatTime } from '@/lib/labels';
import type {
  Developer,
  Feedback,
  FeedbackStatus,
  FeedbackType,
  Paginated,
  Project,
  ProjectStatus,
} from '@/lib/types';
import {
  BugOutlined,
  CloudSyncOutlined,
  CodeOutlined,
  FileTextOutlined,
  GithubOutlined,
  PlusOutlined,
  ReloadOutlined,
  UserAddOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Timeline,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

/** 反馈类型下拉选项 */
const FEEDBACK_TYPE_OPTIONS: Array<{ label: string; value: FeedbackType }> = [
  { label: '缺陷反馈', value: 'BUG' },
  { label: '改进建议', value: 'IMPROVEMENT' },
  { label: '使用咨询', value: 'QUESTION' },
];

/** 可选的反馈状态流转 */
const FEEDBACK_STATUS_OPTIONS: Array<{ label: string; value: FeedbackStatus }> = [
  { label: '待处理', value: 'OPEN' },
  { label: '处理中', value: 'PROCESSING' },
  { label: '已解决', value: 'RESOLVED' },
  { label: '已关闭', value: 'CLOSED' },
];

/** 项目状态可选流转 */
const PROJECT_STATUS_OPTIONS: Array<{ label: string; value: ProjectStatus }> = [
  { label: '待认领', value: 'OPEN' },
  { label: '已认领', value: 'CLAIMED' },
  { label: '开发中', value: 'DEVELOPING' },
  { label: '已发布', value: 'RELEASED' },
  { label: '已关闭', value: 'CLOSED' },
];

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = params?.id as string;
  const { user, isAdmin } = useAuth();

  const [project, setProject] = useState<Project | null>(null);
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'detail' | 'dev' | 'feedback'>('detail');

  // 反馈提交
  const [feedbackForm] = Form.useForm<{ type: FeedbackType; title: string; content: string }>();
  const [submittingFeedback, setSubmittingFeedback] = useState(false);

  // 反馈详情抽屉
  const [activeFeedback, setActiveFeedback] = useState<Feedback | null>(null);
  const [commentText, setCommentText] = useState('');
  const [commentLoading, setCommentLoading] = useState(false);

  // 认领与协作者
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimRemark, setClaimRemark] = useState('');
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [memberOpen, setMemberOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<string | undefined>(undefined);

  // 共同需求人
  const [requesterOpen, setRequesterOpen] = useState(false);
  const [selectedRequester, setSelectedRequester] = useState<string | undefined>(undefined);

  /** 加载项目详情与反馈列表 */
  const load = useCallback(async () => {
    if (!projectId) {
      return;
    }
    setLoading(true);
    try {
      const [projectData, feedbackData] = await Promise.all([
        api.get<Project>(`/projects/${projectId}`),
        api.get<Paginated<Feedback>>(`/projects/${projectId}/feedbacks`, { pageSize: 50 }),
      ]);
      setProject(projectData);
      setFeedbacks(feedbackData.items);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 是否具备项目管理权限 */
  const canManage = useMemo(() => {
    if (!project || !user) {
      return false;
    }
    return isAdmin || project.ownerId === user.id || project.creatorId === user.id;
  }, [project, user, isAdmin]);

  /**
   * 是否可增删「共同需求人」名单
   * 只有平台管理员能替别人登记或移除，其他同事一律只能管理自己（「我也需要」/ 退出）
   */
  const canManageRequesters = isAdmin;

  /** 当前用户是否已加入共同需求人 */
  const isRequester = useMemo(
    () => Boolean(project?.requesters?.some((item) => item.user.id === user?.id)),
    [project, user],
  );

  /** 认领需求 */
  const submitClaim = async () => {
    try {
      await api.post(`/projects/${projectId}/claim`, { remark: claimRemark });
      message.success('认领成功，系统已为你创建 Git 仓库');
      setClaimOpen(false);
      setClaimRemark('');
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '认领失败');
    }
  };

  /** 创建或修复仓库 */
  const ensureRepository = async () => {
    try {
      const result = await api.post<{ message: string; repoUrl?: string }>(`/projects/${projectId}/repository`);
      message.success(result.message);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
    }
  };

  /** 同步仓库 PR */
  const syncPullRequests = async () => {
    try {
      const result = await api.post<{ message: string; synced: number }>(`/projects/${projectId}/sync`);
      message.success(`${result.message}，共 ${result.synced} 个 PR`);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '同步失败');
    }
  };

  /** 变更项目状态 */
  const changeStatus = async (status: ProjectStatus) => {
    try {
      await api.patch(`/projects/${projectId}/status`, { status });
      message.success('状态已更新');
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
    }
  };

  /** 打开协作者弹窗并加载同事列表 */
  const openMemberModal = async () => {
    setMemberOpen(true);
    if (developers.length === 0) {
      try {
        const result = await api.get<Paginated<Developer>>('/users/developers', { pageSize: 100 });
        setDevelopers(result.items);
      } catch {
        // 忽略
      }
    }
  };

  /** 添加协作者 */
  const addMember = async () => {
    if (!selectedMember) {
      message.warning('请选择要添加的同事');
      return;
    }
    try {
      await api.post(`/projects/${projectId}/members`, { userId: selectedMember });
      message.success('已添加协作者，并同步了仓库权限');
      setMemberOpen(false);
      setSelectedMember(undefined);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '添加失败');
    }
  };

  /** 打开共同需求人弹窗并加载同事列表 */
  const openRequesterModal = async () => {
    setRequesterOpen(true);
    if (developers.length === 0) {
      try {
        const result = await api.get<Paginated<Developer>>('/users/developers', { pageSize: 100 });
        setDevelopers(result.items);
      } catch {
        // 忽略
      }
    }
  };

  /** 「我也需要」：把自己加为共同需求人 */
  const joinAsRequester = async () => {
    try {
      await api.post(`/projects/${projectId}/requesters`, {});
      message.success('已加入共同需求人，需求方会收到提醒');
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
    }
  };

  /** 需求方添加指定的共同需求人 */
  const addRequester = async () => {
    if (!selectedRequester) {
      message.warning('请选择同事');
      return;
    }
    try {
      await api.post(`/projects/${projectId}/requesters`, { userId: selectedRequester });
      message.success('已添加共同需求人');
      setRequesterOpen(false);
      setSelectedRequester(undefined);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '添加失败');
    }
  };

  /** 移除共同需求人（本人退出或需求方移除） */
  const removeRequester = async (userId: string) => {
    try {
      await api.delete(`/projects/${projectId}/requesters/${userId}`);
      message.success('已更新共同需求人');
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
    }
  };

  /** 提交反馈 */
  const submitFeedback = async (values: { type: FeedbackType; title: string; content: string }) => {
    setSubmittingFeedback(true);
    try {
      await api.post(`/projects/${projectId}/feedbacks`, values);
      message.success('反馈已提交，并同步到仓库 Issue');
      feedbackForm.resetFields();
      await load();
      setTab('feedback');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '提交失败');
    } finally {
      setSubmittingFeedback(false);
    }
  };

  /** 打开反馈详情 */
  const openFeedback = async (feedbackId: string) => {
    try {
      const detail = await api.get<Feedback>(`/feedbacks/${feedbackId}`);
      setActiveFeedback(detail);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载反馈详情失败');
    }
  };

  /** 追加评论 */
  const submitComment = async () => {
    if (!activeFeedback || !commentText.trim()) {
      return;
    }
    setCommentLoading(true);
    try {
      const detail = await api.post<Feedback>(`/feedbacks/${activeFeedback.id}/comments`, {
        content: commentText,
      });
      setActiveFeedback(detail);
      setCommentText('');
      message.success('回复已同步到仓库 Issue');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '回复失败');
    } finally {
      setCommentLoading(false);
    }
  };

  /** 变更反馈状态 */
  const changeFeedbackStatus = async (status: FeedbackStatus) => {
    if (!activeFeedback) {
      return;
    }
    try {
      const detail = await api.patch<Feedback>(`/feedbacks/${activeFeedback.id}/status`, { status });
      setActiveFeedback(detail);
      message.success('反馈状态已更新');
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
    }
  };

  if (loading && !project) {
    return (
      <div className="page-container" style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="page-container">
        <Empty description="项目不存在或已被删除" />
      </div>
    );
  }

  const canClaim =
    project.status === 'OPEN' && user && project.creatorId !== user.id && project.ownerId !== user.id;

  return (
    <div className="page-container">
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
        <Space direction="vertical" size={6}>
          <Space wrap>
            <AvatarBadge
              kind="task"
              value={project.avatar}
              name={project.title}
              size={40}
              tooltip={`任务头像：${project.title}`}
            />
            <Typography.Title level={4} style={{ margin: 0 }}>
              {project.title}
            </Typography.Title>
            <ProjectStatusTag status={project.status} />
            {project.tags?.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </Space>

          <Space size={16} wrap>
            <Space size={6}>
              <span className="text-muted">需求方：</span>
              <AvatarBadge value={project.creator?.avatarUrl} name={project.creator?.name} size={22} />
              <span>{project.creator?.name ?? '-'}</span>
            </Space>
            <Space size={6}>
              <span className="text-muted">负责人：</span>
              {project.owner ? (
                <>
                  <AvatarBadge value={project.owner.avatarUrl} name={project.owner.name} size={22} />
                  <span>{project.owner.name}</span>
                </>
              ) : (
                <span className="text-muted">待认领</span>
              )}
            </Space>
            <span className="text-muted">创建于 {formatTime(project.createdAt)}</span>
          </Space>
        </Space>

        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
          {canClaim && (
            <Button type="primary" onClick={() => setClaimOpen(true)}>
              认领这个需求
            </Button>
          )}
          {canManage && (
            <>
              <Button icon={<UserAddOutlined />} onClick={openMemberModal}>
                添加协作者
              </Button>
              <Select
                placeholder="变更状态"
                style={{ width: 130 }}
                value={project.status}
                options={PROJECT_STATUS_OPTIONS}
                onChange={changeStatus}
              />
            </>
          )}
        </Space>
      </Space>

      {!project.repoUrl && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="该项目尚未创建 Git 仓库"
          description="认领后系统会自动建仓；若自动建仓失败，可由项目负责人或管理员手动重试。"
          action={
            canManage ? (
              <Button size="small" type="primary" onClick={ensureRepository}>
                立即创建
              </Button>
            ) : undefined
          }
        />
      )}

      <Card style={{ marginBottom: 16 }}>
        <Row gutter={[24, 12]}>
          <Col xs={24} md={8}>
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Typography.Text strong>完成进度</Typography.Text>
              <Progress
                percent={project.progress ?? 0}
                strokeColor={PROJECT_PROGRESS_COLOR[project.status]}
              />
              <Descriptions column={1} size="small">
                <Descriptions.Item label="Git 仓库">
                  {project.repoUrl ? (
                    <Typography.Link onClick={() => void openGitea(project.repoUrl)}>
                      <GithubOutlined /> {project.repoOwner}/{project.repoName}
                    </Typography.Link>
                  ) : (
                    <Typography.Text type="secondary">未创建</Typography.Text>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="期望交付">
                  {project.expectedAt ? formatTime(project.expectedAt) : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="认领时间">
                  {project.claimedAt ? formatTime(project.claimedAt) : '-'}
                </Descriptions.Item>
              </Descriptions>
            </Space>
          </Col>
          <Col xs={24} md={8}>
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Typography.Text strong>项目成员</Typography.Text>
              <Space wrap>
                {project.members?.length ? (
                  project.members.map((member) => (
                    <Tag key={member.id} color={member.role === 'OWNER' ? 'blue' : 'default'}>
                      {member.user.name}
                      {member.role === 'OWNER' ? '（负责人）' : ''}
                    </Tag>
                  ))
                ) : (
                  <Typography.Text type="secondary">暂无成员</Typography.Text>
                )}
              </Space>
              {project.repoUrl && (
                <Button type="link" size="small" icon={<CloudSyncOutlined />} onClick={syncPullRequests}>
                  同步仓库 PR
                </Button>
              )}
            </Space>
          </Col>
          <Col xs={24} md={8}>
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Space size={6}>
                <Typography.Text strong>共同需求人</Typography.Text>
                <span className="text-muted">还有谁也想要这个需求</span>
              </Space>
              <AvatarStack
                size={28}
                max={8}
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
                  ...(project.requesters ?? []).map((item) => ({
                    id: item.user.id,
                    name: item.user.name,
                    avatarUrl: item.user.avatarUrl,
                    tip: `${item.user.name}（共同需求人）`,
                  })),
                ]}
              />
              <Space wrap size={4}>
                {(project.requesters ?? []).map((item) => (
                  <Tag
                    key={item.id}
                    closable={canManageRequesters || item.user.id === user?.id}
                    onClose={(event) => {
                      event.preventDefault();
                      void removeRequester(item.user.id);
                    }}
                  >
                    {item.user.name}
                  </Tag>
                ))}
                {(project.requesters ?? []).length === 0 && (
                  <Typography.Text type="secondary">暂无共同需求人</Typography.Text>
                )}
              </Space>
              <Space wrap>
                {user && user.id !== project.creatorId && !isRequester && (
                  <Button size="small" type="primary" onClick={joinAsRequester}>
                    ＋ 我也需要
                  </Button>
                )}
                {user && user.id !== project.creatorId && isRequester && (
                  <Button size="small" onClick={() => removeRequester(user.id)}>
                    退出共同需求人
                  </Button>
                )}
                {canManageRequesters && (
                  <Button size="small" icon={<UserAddOutlined />} onClick={openRequesterModal}>
                    添加共同需求人
                  </Button>
                )}
              </Space>
            </Space>
          </Col>
        </Row>
      </Card>

      <Segmented
        style={{ marginBottom: 16 }}
        value={tab}
        onChange={(value) => setTab(value as typeof tab)}
        options={[
          { label: '需求详情', value: 'detail', icon: <FileTextOutlined /> },
          { label: `协作开发（${project.pullRequests?.length ?? 0}）`, value: 'dev', icon: <CodeOutlined /> },
          { label: `反馈（${feedbacks.length}）`, value: 'feedback', icon: <BugOutlined /> },
        ]}
      />

      {tab === 'detail' && (
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={16}>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Card title="需求描述">
                <Typography.Paragraph className="pre-wrap">{project.description}</Typography.Paragraph>
                <Divider />
                <Typography.Title level={5}>验收标准</Typography.Title>
                <Typography.Paragraph className="pre-wrap">
                  {project.acceptanceCriteria || '需求方未填写验收标准'}
                </Typography.Paragraph>
              </Card>

              <Card
                title={`需求图片与附件（${project.attachmentCount ?? 0}）`}
                extra={<span className="text-muted">图片可点击放大，附件可直接下载</span>}
              >
                {project.attachmentCount ? (
                  <AttachmentGallery images={project.images} files={project.files} />
                ) : (
                  <EmptyAttachments />
                )}
              </Card>
            </Space>
          </Col>
          <Col xs={24} lg={8}>
            <Card title="认领记录">
              <Timeline
                items={
                  project.claims?.length
                    ? project.claims.map((claim) => ({
                        children: (
                          <Space direction="vertical" size={2}>
                            <span>
                              <b>{claim.user.name}</b> 认领于 {formatTime(claim.createdAt)}
                            </span>
                            {claim.remark && <span className="text-muted">{claim.remark}</span>}
                          </Space>
                        ),
                      }))
                    : [{ children: <span className="text-muted">暂无认领记录</span> }]
                }
              />
            </Card>
          </Col>
        </Row>
      )}

      {tab === 'dev' && (
        <Card
          title="Pull Request 与 CI 状态"
          extra={
            project.repoUrl ? (
              <Space>
                <Button size="small" icon={<CloudSyncOutlined />} onClick={syncPullRequests}>
                  同步 PR
                </Button>
                <Tooltip title="平台会自动完成 Git 服务登录">
                  <Button size="small" type="primary" onClick={() => void openGitea(project.repoUrl)}>
                    前往仓库
                  </Button>
                </Tooltip>
              </Space>
            ) : null
          }
        >
          <Table
            rowKey="id"
            dataSource={project.pullRequests ?? []}
            pagination={false}
            locale={{ emptyText: <Empty description="暂无 Pull Request，创建分支并提交 PR 后会在此展示" /> }}
            columns={[
              {
                title: 'PR',
                dataIndex: 'number',
                width: 90,
                render: (number: number, record) => (
                  <a href={record.htmlUrl} target="_blank" rel="noreferrer">
                    #{number}
                  </a>
                ),
              },
              { title: '标题', dataIndex: 'title' },
              {
                title: '分支',
                width: 200,
                render: (_, record) => (
                  <span className="text-muted">
                    {record.headBranch} → {record.baseBranch}
                  </span>
                ),
              },
              {
                title: '状态',
                width: 110,
                render: (_, record) => <PullRequestStateTag state={record.state} merged={record.merged} />,
              },
              {
                title: 'CI',
                width: 120,
                render: (_, record) => <CiStatusTag status={record.ciStatus} />,
              },
              {
                title: '提交人',
                width: 160,
                render: (_, record) => (
                  <Space size={6}>
                    <AvatarBadge
                      value={record.author?.avatarUrl}
                      name={record.author?.name ?? record.authorName}
                      size={22}
                    />
                    <span>{record.author?.name ?? record.authorName}</span>
                  </Space>
                ),
              },
              {
                title: '更新时间',
                dataIndex: 'updatedAt',
                width: 150,
                render: (value: string) => <span className="text-muted">{formatTime(value)}</span>,
              },
            ]}
          />
        </Card>
      )}

      {tab === 'feedback' && (
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={10}>
            <Card title="提交反馈" extra={<span className="text-muted">会自动同步为仓库 Issue</span>}>
              <Form form={feedbackForm} layout="vertical" onFinish={submitFeedback} initialValues={{ type: 'BUG' }}>
                <Form.Item name="type" label="反馈类型" rules={[{ required: true }]}>
                  <Select options={FEEDBACK_TYPE_OPTIONS} />
                </Form.Item>
                <Form.Item
                  name="title"
                  label="标题"
                  rules={[{ required: true, min: 4, max: 120, message: '请输入 4-120 个字符的标题' }]}
                >
                  <Input placeholder="例如：导出 Excel 时中文乱码" />
                </Form.Item>
                <Form.Item
                  name="content"
                  label="详细描述"
                  rules={[{ required: true, min: 10, message: '请至少填写 10 个字符' }]}
                >
                  <Input.TextArea rows={6} placeholder="请描述现象、复现步骤与期望结果" maxLength={3000} showCount />
                </Form.Item>
                <Button type="primary" htmlType="submit" loading={submittingFeedback} block>
                  提交反馈
                </Button>
              </Form>
            </Card>
          </Col>
          <Col xs={24} lg={14}>
            <Card title="反馈列表">
              <List
                dataSource={feedbacks}
                locale={{ emptyText: <Empty description="暂无反馈" /> }}
                renderItem={(item) => (
                  <List.Item
                    actions={[
                      <Button key="detail" type="link" onClick={() => openFeedback(item.id)}>
                        查看讨论
                      </Button>,
                    ]}
                  >
                    <List.Item.Meta
                      title={
                        <Space wrap>
                          <a onClick={() => openFeedback(item.id)}>{item.title}</a>
                          <FeedbackTypeTag type={item.type} />
                          <FeedbackStatusTag status={item.status} />
                        </Space>
                      }
                      description={
                        <Space size={12} wrap>
                          <Space size={6}>
                            <AvatarBadge value={item.user?.avatarUrl} name={item.user?.name} size={22} />
                            <span className="text-muted">提交人：{item.user?.name ?? '-'}</span>
                          </Space>
                          <span className="text-muted">{formatTime(item.createdAt)}</span>
                          <span className="text-muted">讨论 {item._count?.comments ?? 0} 条</span>
                          {item.issueNumber && (
                            <Typography.Link onClick={() => void openGitea(item.issueUrl)}>
                              Issue #{item.issueNumber}
                            </Typography.Link>
                          )}
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            </Card>
          </Col>
        </Row>
      )}

      {/* 认领弹窗 */}
      <Modal
        open={claimOpen}
        title="认领需求"
        onCancel={() => setClaimOpen(false)}
        onOk={submitClaim}
        okText="确认认领"
      >
        <Typography.Paragraph type="secondary">
          认领后系统会在 Git 服务中创建项目仓库，并为你开通推送权限。请确认你有时间投入开发。
        </Typography.Paragraph>
        <Input.TextArea
          rows={3}
          value={claimRemark}
          onChange={(event) => setClaimRemark(event.target.value)}
          placeholder="可填写实现思路或预计完成时间"
          maxLength={500}
        />
      </Modal>

      {/* 添加协作者弹窗 */}
      <Modal
        open={memberOpen}
        title="添加项目协作者"
        onCancel={() => setMemberOpen(false)}
        onOk={addMember}
        okText="添加"
      >
        <Typography.Paragraph type="secondary">
          添加后该同事会获得仓库写权限，可提交 Pull Request 参与开发。
        </Typography.Paragraph>
        <Select
          showSearch
          style={{ width: '100%' }}
          placeholder="选择同事"
          value={selectedMember}
          onChange={setSelectedMember}
          optionFilterProp="label"
          options={developers.map((item) => ({
            label: `${item.name}${item.department ? `（${item.department}）` : ''} ${
              item.skills?.length ? `· ${item.skills.join('/')}` : ''
            }`,
            value: item.id,
          }))}
        />
      </Modal>

      {/* 添加共同需求人弹窗 */}
      <Modal
        open={requesterOpen}
        title="添加共同需求人"
        onCancel={() => setRequesterOpen(false)}
        onOk={addRequester}
        okText="添加"
      >
        <Typography.Paragraph type="secondary">
          共同需求人会展示在需求方头像旁，方便统计还有哪些同事需要这个需求（不涉及仓库代码权限）。
          由管理员代为登记，其他同事可以在需求页自行点「我也需要」加入。
        </Typography.Paragraph>
        <Select
          showSearch
          style={{ width: '100%' }}
          placeholder="选择同事"
          value={selectedRequester}
          onChange={setSelectedRequester}
          optionFilterProp="label"
          options={developers
            .filter(
              (item) =>
                item.id !== project.creatorId &&
                !(project.requesters ?? []).some((requester) => requester.user.id === item.id),
            )
            .map((item) => ({
              label: `${item.name}${item.department ? `（${item.department}）` : ''}`,
              value: item.id,
            }))}
        />
      </Modal>

      {/* 反馈详情抽屉 */}
      <Drawer
        width={560}
        open={Boolean(activeFeedback)}
        onClose={() => setActiveFeedback(null)}
        title={activeFeedback?.title}
        extra={
          <Select
            size="small"
            style={{ width: 120 }}
            value={activeFeedback?.status}
            options={FEEDBACK_STATUS_OPTIONS}
            onChange={changeFeedbackStatus}
          />
        }
      >
        {activeFeedback && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Space wrap>
              <FeedbackTypeTag type={activeFeedback.type} />
              <FeedbackStatusTag status={activeFeedback.status} />
              {activeFeedback.issueNumber && (
                <span
                  style={{ cursor: 'pointer' }}
                  onClick={() => void openGitea(activeFeedback.issueUrl)}
                >
                  <Tag color="blue">仓库 Issue #{activeFeedback.issueNumber}</Tag>
                </span>
              )}
            </Space>

            <Card size="small" title={`${activeFeedback.user?.name ?? '提交人'} 的描述`}>
              <Typography.Paragraph className="pre-wrap" style={{ marginBottom: 0 }}>
                {activeFeedback.content}
              </Typography.Paragraph>
            </Card>

            <div>
              <Typography.Text strong>讨论记录</Typography.Text>
              <List
                style={{ marginTop: 8 }}
                dataSource={activeFeedback.comments ?? []}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无讨论" /> }}
                renderItem={(comment) => (
                  <List.Item>
                    <List.Item.Meta
                      title={
                        <Space>
                          <span>{comment.user.name}</span>
                          <span className="text-muted">{formatTime(comment.createdAt)}</span>
                        </Space>
                      }
                      description={<span className="pre-wrap">{comment.content}</span>}
                    />
                  </List.Item>
                )}
              />
            </div>

            <Space.Compact style={{ width: '100%' }}>
              <Input.TextArea
                rows={3}
                value={commentText}
                onChange={(event) => setCommentText(event.target.value)}
                placeholder="输入回复内容，会同步到仓库 Issue"
                maxLength={2000}
              />
            </Space.Compact>
            <Button type="primary" loading={commentLoading} onClick={submitComment} icon={<PlusOutlined />}>
              发送回复
            </Button>
          </Space>
        )}
      </Drawer>
    </div>
  );
}
