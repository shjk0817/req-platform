'use client';

/**
 * 项目详情页
 * 作用：展示需求详情、协作开发（PR/CI）、反馈闭环，并提供认领、
 *      成员管理、仓库创建与状态流转等操作入口
 */
import AvatarBadge, { AvatarStack } from '@/components/AvatarBadge';
import { AttachmentGallery, EmptyAttachments } from '@/components/AttachmentUploader';
import MarkdownContent from '@/components/MarkdownContent';
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
import { PROJECT_PROGRESS_COLOR, PROJECT_STAGE_HELP, formatTime } from '@/lib/labels';
import type {
  Developer,
  Feedback,
  FeedbackStatus,
  FeedbackType,
  Paginated,
  Project,
  ProjectStatus,
  ProjectUpdate,
} from '@/lib/types';
import {
  BugOutlined,
  CheckCircleOutlined,
  CloudSyncOutlined,
  CodeOutlined,
  FileTextOutlined,
  GithubOutlined,
  MessageOutlined,
  PlusOutlined,
  ReloadOutlined,
  RocketOutlined,
  UserAddOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Steps,
  Table,
  Tag,
  Timeline,
  Tooltip,
  Typography,
  message,
} from 'antd';
import dayjs from 'dayjs';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

/** 反馈类型下拉选项 */
const FEEDBACK_TYPE_OPTIONS: Array<{ label: string; value: FeedbackType }> = [
  { label: '不好用', value: 'BUG' },
  { label: '和我当初说的不一样', value: 'BUG' },
  { label: '还想加一点', value: 'IMPROVEMENT' },
  { label: '我不会用', value: 'QUESTION' },
];

/** 可选的反馈状态流转 */
const FEEDBACK_STATUS_OPTIONS: Array<{ label: string; value: FeedbackStatus }> = [
  { label: '待处理', value: 'OPEN' },
  { label: '处理中', value: 'PROCESSING' },
  { label: '已解决', value: 'RESOLVED' },
  { label: '已关闭', value: 'CLOSED' },
];

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = params?.id as string;
  const { user, isAdmin } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const initialTab =
    requestedTab === 'dev' ||
    requestedTab === 'feedback' ||
    requestedTab === 'acceptance' ||
    requestedTab === 'updates'
      ? requestedTab
      : 'detail';

  const [project, setProject] = useState<Project | null>(null);
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [updates, setUpdates] = useState<ProjectUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'detail' | 'dev' | 'feedback' | 'acceptance' | 'updates'>(initialTab);

  // 反馈提交
  const [feedbackForm] = Form.useForm<{ type: FeedbackType; title: string; content: string }>();
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const feedbackType = Form.useWatch<FeedbackType>('type', feedbackForm);
  const [updateForm] = Form.useForm<{
    kind: 'COMMUNICATION' | 'ADDITIONAL_REQUIREMENT';
    content: string;
  }>();
  const updateKind = Form.useWatch('kind', updateForm) ?? 'COMMUNICATION';
  const [submittingUpdate, setSubmittingUpdate] = useState(false);

  // 反馈详情抽屉
  const [activeFeedback, setActiveFeedback] = useState<Feedback | null>(null);
  const [commentText, setCommentText] = useState('');
  const [commentLoading, setCommentLoading] = useState(false);
  const [acceptanceNotes, setAcceptanceNotes] = useState<Record<string, string>>({});
  const [acceptanceResults, setAcceptanceResults] = useState<
    Record<string, 'PENDING' | 'PASSED' | 'FAILED'>
  >({});
  const [acceptanceRemark, setAcceptanceRemark] = useState('');
  const [acceptanceLoading, setAcceptanceLoading] = useState(false);

  // 认领与协作者
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimRemark, setClaimRemark] = useState('');
  const [claimRepoName, setClaimRepoName] = useState('');
  const [claimRepoDisplayName, setClaimRepoDisplayName] = useState('');
  const [developers, setDevelopers] = useState<Developer[]>([]);

  // 共同需求人
  const [requesterOpen, setRequesterOpen] = useState(false);
  const [selectedRequester, setSelectedRequester] = useState<string | undefined>(undefined);
  const [developerLoading, setDeveloperLoading] = useState(false);
  const [joiningDevelopment, setJoiningDevelopment] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm] = Form.useForm();
  const [editing, setEditing] = useState(false);
  const [repositoryOpen, setRepositoryOpen] = useState(false);
  const [repositoryForm] = Form.useForm<{ repoName?: string; repoDisplayName?: string }>();

  /** 加载项目详情与反馈列表 */
  const load = useCallback(async () => {
    if (!projectId) {
      return;
    }
    setLoading(true);
    try {
      const [projectData, feedbackData, updateData] = await Promise.all([
        api.get<Project>(`/projects/${projectId}`),
        api.get<Paginated<Feedback>>(`/projects/${projectId}/feedbacks`, { pageSize: 50 }),
        api.get<ProjectUpdate[]>(`/projects/${projectId}/updates`),
      ]);
      setProject(projectData);
      setFeedbacks(feedbackData.items);
      setUpdates(updateData);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 把当前页签写回地址，保证通知链接、刷新和分享链接都能落到同一处 */
  useEffect(() => {
    if (!projectId) {
      return;
    }
    if (searchParams.get('tab') === tab) {
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    router.replace(`/projects/${projectId}?${params.toString()}`, { scroll: false });
  }, [projectId, router, searchParams, tab]);

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
  const canPostUpdate = Boolean(
    user &&
      (isAdmin ||
        project?.creatorId === user.id ||
        project?.ownerId === user.id ||
        isRequester ||
        project?.members?.some((member) => member.user.id === user.id)),
  );

  /** 认领需求 */
  const submitClaim = async () => {
    try {
      await api.post(`/projects/${projectId}/claim`, {
        remark: claimRemark,
        repoName: claimRepoName.trim() || undefined,
        repoDisplayName: claimRepoDisplayName.trim() || undefined,
      });
      message.success('接手成功，系统已为你创建代码库');
      setClaimOpen(false);
      setClaimRemark('');
      setClaimRepoName('');
      setClaimRepoDisplayName('');
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '认领失败');
    }
  };

  /** 创建或修复仓库 */
  const ensureRepository = async () => {
    const values = await repositoryForm.validateFields();
    try {
      const result = await api.post<{ message: string; repoUrl?: string }>(
        `/projects/${projectId}/repository`,
        {
          repoName: values.repoName?.trim() || undefined,
          repoDisplayName: values.repoDisplayName?.trim() || undefined,
        },
      );
      message.success(result.message);
      setRepositoryOpen(false);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
    }
  };

  /** 打开仓库创建弹窗，并预填需求标题作为中文别名 */
  const openRepositoryModal = () => {
    repositoryForm.setFieldsValue({
      repoDisplayName: project?.repoDisplayName ?? project?.title,
      repoName: project?.repoName ?? undefined,
    });
    setRepositoryOpen(true);
  };

  /** 同步代码库里的修改记录 */
  const syncPullRequests = async () => {
    try {
      const result = await api.post<{ message: string; synced: number }>(`/projects/${projectId}/sync`);
      message.success(`${result.message}，共同步 ${result.synced} 条修改记录`);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '同步失败');
    }
  };

  /** 变更项目状态 */
  const changeStatus = async (status: ProjectStatus, remark?: string) => {
    try {
      await api.patch(`/projects/${projectId}/status`, { status, remark });
      message.success('状态已更新');
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
    }
  };

  /** 按姓名或部门搜索可协作同事，避免一次拉取并截断名单 */
  const searchDevelopers = async (keyword = '') => {
    setDeveloperLoading(true);
    try {
      const result = await api.get<Paginated<Developer>>('/users/developers', {
        pageSize: 20,
        keyword: keyword || undefined,
      });
      setDevelopers(result.items);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载同事列表失败');
    } finally {
      setDeveloperLoading(false);
    }
  };

  /** 当前用户自助加入项目开发 */
  const joinDevelopment = async () => {
    setJoiningDevelopment(true);
    try {
      await api.post(`/projects/${projectId}/join`, {});
      message.success('已加入开发，代码库写权限已同步');
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加入开发失败');
    } finally {
      setJoiningDevelopment(false);
    }
  };

  /** 打开共同需求人弹窗并加载同事列表 */
  const openRequesterModal = async () => {
    setRequesterOpen(true);
    if (developers.length === 0) {
      await searchDevelopers();
    }
  };

  /** 打开需求编辑表单 */
  const openEditModal = () => {
    editForm.setFieldsValue({
      title: project?.title,
      description: project?.description,
      acceptanceCriteria: project?.acceptanceCriteria ?? '',
      expectedAt: project?.expectedAt ? dayjs(project.expectedAt) : undefined,
      demoUrl: project?.demoUrl ?? '',
    });
    setEditOpen(true);
  };

  /** 保存需求描述、验收清单与成果展示地址 */
  const submitEdit = async () => {
    const values = await editForm.validateFields();
    const ownerOnlyEdit = Boolean(
      project &&
        user &&
        project.ownerId === user.id &&
        project.creatorId !== user.id &&
        !isAdmin,
    );
    setEditing(true);
    try {
      const payload = ownerOnlyEdit
        ? { demoUrl: values.demoUrl?.trim() || undefined }
        : {
            ...values,
            acceptanceItems: values.acceptanceCriteria
              ? String(values.acceptanceCriteria)
                  .split(/\n+/)
                  .map((item: string) => item.trim())
                  .filter(Boolean)
              : [],
            expectedAt: values.expectedAt ? values.expectedAt.toISOString() : undefined,
          };
      await api.put(`/projects/${projectId}`, payload);
      message.success('需求内容已更新');
      setEditOpen(false);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setEditing(false);
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
      message.success('反馈已提交，负责人会在代码库和平台两边看到');
      feedbackForm.resetFields();
      await load();
      setTab('feedback');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '提交失败');
    } finally {
      setSubmittingFeedback(false);
    }
  };

  /** 发布沟通或追加需求，原始需求正文始终保留 */
  const submitUpdate = async (values: {
    kind: 'COMMUNICATION' | 'ADDITIONAL_REQUIREMENT';
    content: string;
  }) => {
    setSubmittingUpdate(true);
    try {
      await api.post(`/projects/${projectId}/updates`, {
        kind: values.kind,
        content: values.content.trim(),
      });
      message.success(values.kind === 'ADDITIONAL_REQUIREMENT' ? '追加需求已记录并通知负责人' : '沟通记录已发布');
      updateForm.resetFields();
      await load();
      setTab('updates');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '发布记录失败');
    } finally {
      setSubmittingUpdate(false);
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

  /** 处理通知中的反馈深链 */
  useEffect(() => {
    const feedbackId = searchParams.get('feedbackId');
    if (feedbackId && tab === 'feedback') {
      void openFeedback(feedbackId);
    }
  }, [searchParams, tab]);

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
      message.success('回复已同步给负责人');
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

  /** 提交需求方的逐条试用结果 */
  const submitAcceptance = async () => {
    if (!project) {
      return;
    }
    const items = (project.acceptanceItems ?? []).map((item) => ({
      id: item.id,
      result: acceptanceResults[item.id] ?? item.result,
      note: acceptanceNotes[item.id],
    }));
    if (items.length > 0 && items.some((item) => item.result === 'PENDING')) {
      message.warning('请逐条选择「可以」或「这里不行」');
      return;
    }
    if (items.length === 0 && !acceptanceRemark.trim()) {
      message.warning('请填写整体试用结果');
      return;
    }
    setAcceptanceLoading(true);
    try {
      await api.post(`/projects/${projectId}/acceptance`, {
        items,
        remark: acceptanceRemark.trim() || undefined,
      });
      message.success(items.some((item) => item.result === 'FAILED') ? '已记录问题并通知负责人' : '已确认可以使用');
      await load();
      setAcceptanceRemark('');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '提交试用结果失败');
    } finally {
      setAcceptanceLoading(false);
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

  const isProjectMember = Boolean(project.members?.some((member) => member.user.id === user?.id));
  const canClaim = Boolean(project.status === 'OPEN' && user && project.ownerId !== user.id);
  const canJoinDevelopment = Boolean(
    user && project.ownerId && project.status !== 'CLOSED' && project.ownerId !== user.id && !isProjectMember,
  );
  const canSubmitAcceptance = Boolean(user && (isAdmin || project.creatorId === user.id));

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
              我来做
            </Button>
          )}
          {canJoinDevelopment && (
            <Button
              icon={<UserAddOutlined />}
              loading={joiningDevelopment}
              onClick={() => void joinDevelopment()}
            >
              加入开发
            </Button>
          )}
          {user && project.ownerId === user.id && ['CLAIMED', 'DEVELOPING'].includes(project.status) && (
            <Popconfirm
              title="把需求交还需求池？"
              description="会收回你的代码修改权限，需求方会收到通知；代码库和历史记录会保留。"
              okText="交还"
              cancelText="先不交还"
              onConfirm={() => {
                void (async () => {
                  try {
                    await api.post(`/projects/${projectId}/return`, {});
                    message.success('已交还需求池');
                    await load();
                  } catch (error) {
                    message.error(error instanceof Error ? error.message : '交还失败');
                  }
                })();
              }}
            >
              <Button>交还需求池</Button>
            </Popconfirm>
          )}
          {canManage && (
            <>
              {(isAdmin || project.creatorId === user?.id || project.ownerId === user?.id) && (
                <Button onClick={openEditModal}>修改需求</Button>
              )}
            </>
          )}
        </Space>
      </Space>

      {!project.repoUrl && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="该项目尚未创建代码库"
          description="接手后系统会自动创建；如果创建失败，负责人或管理员可以重试。"
          action={
            canManage ? (
              <Button size="small" type="primary" onClick={openRepositoryModal}>
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
              <Typography.Text type="secondary">
                {project.acceptedAt
                  ? '需求方已经试用通过，这条需求已完成。'
                  : PROJECT_STAGE_HELP[project.status]}
              </Typography.Text>
              <Descriptions column={1} size="small">
                <Descriptions.Item label="代码库">
                  {project.repoUrl ? (
                    <Space direction="vertical" size={2}>
                      <Typography.Link onClick={() => void openGitea(project.repoUrl)}>
                        <GithubOutlined /> {project.repoOwner}/{project.repoName}
                      </Typography.Link>
                      {project.repoDisplayName && (
                        <Typography.Text type="secondary">
                          中文别名：{project.repoDisplayName}
                        </Typography.Text>
                      )}
                    </Space>
                  ) : (
                    <Typography.Text type="secondary">未创建</Typography.Text>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="成果展示">
                  {project.demoUrl ? (
                    <Typography.Link href={project.demoUrl} target="_blank" rel="noreferrer">
                      打开成果展示
                    </Typography.Link>
                  ) : (
                    <Typography.Text type="secondary">负责人还没有填写展示地址</Typography.Text>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="期望交付">
                  {project.expectedAt ? (
                    <Space size={6}>
                      <span>{formatTime(project.expectedAt)}</span>
                      {project.overdue && <Tag color="red">已晚 {project.overdueDays ?? 0} 天</Tag>}
                    </Space>
                  ) : (
                    '-'
                  )}
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
                      {member.role === 'OWNER' ? '（负责人）' : '（协作者）'}
                    </Tag>
                  ))
                ) : (
                  <Typography.Text type="secondary">暂无成员</Typography.Text>
                )}
              </Space>
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

      {user && project.ownerId === user.id && ['CLAIMED', 'DEVELOPING'].includes(project.status) && (
        <Card
          title="接手后按这四步做"
          style={{ marginBottom: 16 }}
          extra={<Typography.Text type="secondary">完成条件来自实际记录，不需要手动打勾</Typography.Text>}
        >
          <Steps
            current={
              !project.repoUrl
                ? 0
                : !project.pullRequests?.length
                  ? 1
                  : project.pullRequests.some((item) => item.ciStatus === 'success')
                    ? 3
                    : 2
            }
            items={[
              {
                title: '打开代码库',
                description: project.repoUrl ? '已打开或已创建' : '平台会帮你登录',
              },
              {
                title: '提交一版修改',
                description: project.pullRequests?.length ? '已有修改记录' : '在代码库里完成修改',
              },
              {
                title: '自动检查',
                description: project.pullRequests?.some((item) => item.ciStatus === 'success')
                  ? '最近一次检查通过'
                  : '检查还没通过',
              },
              {
                title: '请需求方试用',
                description: '完成后让提出需求的人按清单试用',
              },
            ]}
          />
          {!project.repoUrl && (
            <Button type="primary" style={{ marginTop: 16 }} onClick={openRepositoryModal}>
              创建代码库
            </Button>
          )}
          {project.repoUrl && !project.pullRequests?.length && (
            <Button type="primary" style={{ marginTop: 16 }} onClick={() => void openGitea(project.repoUrl)}>
              打开代码库开始修改
            </Button>
          )}
          {project.repoUrl &&
            project.pullRequests?.length &&
            !project.pullRequests.some((item) => item.ciStatus === 'success') && (
              <Alert
                type="warning"
                showIcon
                style={{ marginTop: 16 }}
                message="自动检查还没通过"
                description="先查看代码库里的检查记录并修改，不要急着请需求方试用。"
              />
            )}
          {project.pullRequests?.some((item) => item.ciStatus === 'success') && (
            <Button type="primary" style={{ marginTop: 16 }} onClick={() => changeStatus('RELEASED')}>
              请需求方试用
            </Button>
          )}
        </Card>
      )}

      <Space wrap style={{ marginBottom: 16 }}>
        <Segmented
          value={tab}
          onChange={(value) => setTab(value as typeof tab)}
          options={[
            { label: '需求详情', value: 'detail', icon: <FileTextOutlined /> },
            { label: `沟通记录（${updates.length}）`, value: 'updates', icon: <MessageOutlined /> },
            { label: `协作开发（${project.pullRequests?.length ?? 0}）`, value: 'dev', icon: <CodeOutlined /> },
            { label: `反馈（${feedbacks.length}）`, value: 'feedback', icon: <BugOutlined /> },
            ...(project.status === 'RELEASED' && canSubmitAcceptance
              ? [{ label: '试用验收', value: 'acceptance', icon: <CheckCircleOutlined /> }]
              : []),
          ]}
        />
        <Link href={`/projects/${projectId}/deliverables`}>
          <Button icon={<RocketOutlined />}>查看成果</Button>
        </Link>
      </Space>

      {tab === 'detail' && (
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={16}>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Card title="需求描述">
                <MarkdownContent content={project.description} />
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
            <Card title="进展记录">
              <Timeline
                items={
                  project.timeline?.length
                    ? project.timeline.map((event) => ({
                        color: event.type === 'feedback' ? 'orange' : 'blue',
                        children: (
                          <Space direction="vertical" size={2}>
                            <span>
                              <b>{event.text}</b> · {formatTime(event.at)}
                            </span>
                            {event.detail && <span className="text-muted">{event.detail}</span>}
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

      {tab === 'updates' && (
        <Row gutter={[16, 16]}>
          {canPostUpdate && (
            <Col xs={24} lg={10}>
              <Card title="补充沟通或追加需求">
                <Typography.Paragraph type="secondary">
                  原始需求不会被覆盖。需要增加范围时请选择「追加需求」，普通进展和问题请选择「沟通记录」。
                </Typography.Paragraph>
                <Form
                  form={updateForm}
                  layout="vertical"
                  initialValues={{ kind: 'COMMUNICATION' }}
                  onFinish={submitUpdate}
                >
                  <Form.Item name="kind" label="记录类型">
                    <Segmented
                      block
                      options={[
                        { label: '沟通记录', value: 'COMMUNICATION' },
                        { label: '追加需求', value: 'ADDITIONAL_REQUIREMENT' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item
                    name="content"
                    label={updateKind === 'ADDITIONAL_REQUIREMENT' ? '新增内容' : '想说什么'}
                    rules={[{ required: true, min: 1, max: 5000, message: '请填写 1-5000 个字符' }]}
                  >
                    <Input.TextArea
                      rows={8}
                      maxLength={5000}
                      showCount
                      placeholder={
                        updateKind === 'ADDITIONAL_REQUIREMENT'
                          ? '写清新增的范围、原因或期望结果'
                          : '可以记录进展、问题、疑问或下一步约定'
                      }
                    />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" loading={submittingUpdate} block>
                    发布记录
                  </Button>
                </Form>
              </Card>
            </Col>
          )}
          <Col xs={24} lg={canPostUpdate ? 14 : 24}>
            <Card title="沟通与追加需求时间线">
              <Timeline
                items={
                  updates.length
                    ? updates.map((item) => ({
                        color: item.kind === 'ADDITIONAL_REQUIREMENT' ? 'orange' : 'blue',
                        children: (
                          <Space direction="vertical" size={4}>
                            <Space wrap>
                              <Typography.Text strong>
                                {item.kind === 'ADDITIONAL_REQUIREMENT' ? '追加需求' : '沟通记录'}
                              </Typography.Text>
                              <Typography.Text type="secondary">
                                {item.author.name} · {formatTime(item.createdAt)}
                              </Typography.Text>
                            </Space>
                            <Typography.Paragraph className="pre-wrap" style={{ marginBottom: 0 }}>
                              {item.content}
                            </Typography.Paragraph>
                          </Space>
                        ),
                      }))
                    : [{ children: <span className="text-muted">还没有沟通记录，可以在这里补充第一条。</span> }]
                }
              />
            </Card>
          </Col>
        </Row>
      )}

      {tab === 'acceptance' && canSubmitAcceptance && (
        <Card
          title="请按清单试用"
          extra={<Typography.Text type="secondary">每一条都试过后再提交</Typography.Text>}
        >
          <Alert
            type="info"
            showIcon
            message="你不需要懂代码"
            description="只要按平时的工作方式试一次。可以就点「可以」，不行就写下哪里不对，负责人会收到反馈。"
            style={{ marginBottom: 16 }}
          />
          {project.acceptanceItems?.length ? (
            <Space direction="vertical" style={{ width: '100%' }} size={12}>
              {project.acceptanceItems.map((item) => {
                const result = acceptanceResults[item.id] ?? item.result;
                return (
                  <Card key={item.id} size="small" type="inner">
                    <Space direction="vertical" style={{ width: '100%' }}>
                      <Typography.Text strong>{item.sort + 1}. {item.content}</Typography.Text>
                      <Segmented
                        value={result}
                        options={[
                          { label: '还没试', value: 'PENDING' },
                          { label: '可以', value: 'PASSED' },
                          { label: '这里不行', value: 'FAILED' },
                        ]}
                        onChange={(value) =>
                          setAcceptanceResults((current) => ({
                            ...current,
                            [item.id]: value as 'PENDING' | 'PASSED' | 'FAILED',
                          }))
                        }
                      />
                      {result === 'FAILED' && (
                        <Input.TextArea
                          rows={2}
                          placeholder="请写下哪里不对，负责人才能准确修改"
                          value={acceptanceNotes[item.id] ?? ''}
                          onChange={(event) =>
                            setAcceptanceNotes((current) => ({
                              ...current,
                              [item.id]: event.target.value,
                            }))
                          }
                        />
                      )}
                    </Space>
                  </Card>
                );
              })}
            </Space>
          ) : (
            <Input.TextArea
              rows={5}
              placeholder="整体试用后，请写下可以使用，或哪里不对"
              value={acceptanceRemark}
              onChange={(event) => setAcceptanceRemark(event.target.value)}
            />
          )}
          {project.acceptanceItems?.length ? (
            <Input.TextArea
              rows={3}
              style={{ marginTop: 16 }}
              placeholder="还有其他整体说明吗？（选填）"
              value={acceptanceRemark}
              onChange={(event) => setAcceptanceRemark(event.target.value)}
            />
          ) : null}
          <Button
            type="primary"
            style={{ marginTop: 16 }}
            loading={acceptanceLoading}
            onClick={() => void submitAcceptance()}
          >
            提交试用结果
          </Button>
        </Card>
      )}

      {tab === 'dev' && (
        <Card
          className="developer-details"
          title="给开发同事的修改记录"
          extra={
            project.repoUrl ? (
              <Space>
                {(isAdmin || project.ownerId === user?.id) && (
                  <Button size="small" icon={<CloudSyncOutlined />} onClick={syncPullRequests}>
                    同步修改记录
                  </Button>
                )}
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
            locale={{ emptyText: <Empty description="暂无修改记录，开发同事完成一版修改后会在此展示" /> }}
            columns={[
              {
                title: '修改',
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
                title: '自动检查',
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
            <Card
              title="说说哪里需要改"
              extra={
                <Button
                  type="link"
                  size="small"
                  onClick={() =>
                    feedbackForm.setFieldsValue({
                      type: 'QUESTION',
                      title: '我想问：',
                      content: '我想问：',
                    })
                  }
                >
                  我有个问题
                </Button>
              }
            >
              <Form form={feedbackForm} layout="vertical" onFinish={submitFeedback} initialValues={{ type: 'BUG' }}>
                <Form.Item name="type" label="先选一句最接近的话" rules={[{ required: true }]}>
                  <Select options={FEEDBACK_TYPE_OPTIONS} />
                </Form.Item>
                {feedbackType === 'QUESTION' && (
                  <Alert
                    type="info"
                    showIcon
                    message="这不一定是程序坏了"
                    description="先看看右下角的操作指引；如果还是不会用，提交问题后负责人会回复你。"
                    style={{ marginBottom: 16 }}
                  />
                )}
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

      {/* 修改需求弹窗：代码库创建后不允许改标题，避免仓库地址失效 */}
      <Modal
        open={editOpen}
        title="修改需求"
        onCancel={() => setEditOpen(false)}
        onOk={() => void submitEdit()}
        confirmLoading={editing}
        okText="保存修改"
      >
        <Form form={editForm} layout="vertical">
          <Form.Item
            name="title"
            label="需求标题"
            rules={[{ required: true, min: 4, max: 120, message: '请输入 4-120 个字符的标题' }]}
          >
            <Input
              disabled={
                Boolean(project.repoName) ||
                Boolean(project.ownerId === user?.id && project.creatorId !== user?.id && !isAdmin)
              }
            />
          </Form.Item>
          {project.repoName && (
            <Typography.Text type="secondary">代码库已经创建，标题不能修改；其他内容仍可以补充。</Typography.Text>
          )}
          <Form.Item name="description" label="需求说明" rules={[{ required: true, min: 10, message: '请至少填写 10 个字符' }]}>
            <Input.TextArea
              rows={6}
              maxLength={5000}
              showCount
              disabled={Boolean(project.ownerId === user?.id && project.creatorId !== user?.id && !isAdmin)}
            />
          </Form.Item>
          <Form.Item name="acceptanceCriteria" label="验收条件（每行一条）">
            <Input.TextArea
              rows={5}
              placeholder="例如：能导出最近 30 天的数据\n导出的金额与系统一致"
              disabled={Boolean(project.ownerId === user?.id && project.creatorId !== user?.id && !isAdmin)}
            />
          </Form.Item>
          <Form.Item name="expectedAt" label="希望哪天能用">
            <DatePicker
              style={{ width: '100%' }}
              disabled={Boolean(project.ownerId === user?.id && project.creatorId !== user?.id && !isAdmin)}
            />
          </Form.Item>
          <Form.Item
            name="demoUrl"
            label="成果展示地址（选填）"
            extra="例如部署后的内部工具地址；保存后会显示在成果页"
            rules={[{ type: 'url', message: '请输入完整 URL，例如 https://example.com' }]}
          >
            <Input placeholder="https://..." />
          </Form.Item>
        </Form>
      </Modal>

      {/* 认领弹窗 */}
      <Modal
        open={claimOpen}
        title="认领需求"
        onCancel={() => setClaimOpen(false)}
        onOk={submitClaim}
        okText="确认认领"
      >
        <Typography.Paragraph type="secondary">
          <b>会发生：</b>你会成为负责人，系统会创建一个公司内部代码库，需求方会收到通知。
          <br />
          <b>不会发生：</b>不会通知全公司；共同需求人不会获得代码修改权限。
        </Typography.Paragraph>
        <Form layout="vertical">
          <Form.Item
            label="仓库中文别名"
            extra="留空时默认使用需求标题，方便在平台和代码库里辨认"
          >
            <Input
              value={claimRepoDisplayName}
              maxLength={120}
              placeholder={project.title}
              onChange={(event) => setClaimRepoDisplayName(event.target.value)}
            />
          </Form.Item>
          <Form.Item
            label="仓库英文名（可选）"
            extra="只使用字母、数字、连字符、下划线或点号；留空由系统生成"
            validateStatus={
              claimRepoName && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(claimRepoName) ? 'error' : undefined
            }
            help={
              claimRepoName && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(claimRepoName)
                ? '仓库名格式不正确'
                : undefined
            }
          >
            <Input
              value={claimRepoName}
              maxLength={100}
              placeholder="例如 monthly-report-tool"
              onChange={(event) => setClaimRepoName(event.target.value)}
            />
          </Form.Item>
        </Form>
        <Input.TextArea
          rows={3}
          value={claimRemark}
          onChange={(event) => setClaimRemark(event.target.value)}
          placeholder="可填写实现思路或预计完成时间"
          maxLength={500}
        />
      </Modal>

      {/* 手动创建仓库弹窗：自动建仓失败时仍可指定更容易辨认的名称 */}
      <Modal
        open={repositoryOpen}
        title="创建代码库"
        onCancel={() => setRepositoryOpen(false)}
        onOk={() => void ensureRepository()}
        okText="创建代码库"
      >
        <Typography.Paragraph type="secondary">
          代码库是开发同事存放成果的地方。中文别名用于平台展示，英文名用于 Gitea 地址。
        </Typography.Paragraph>
        <Form form={repositoryForm} layout="vertical">
          <Form.Item
            name="repoDisplayName"
            label="仓库中文别名"
            rules={[{ max: 120, message: '中文别名最多 120 个字符' }]}
          >
            <Input placeholder={project.title} />
          </Form.Item>
          <Form.Item
            name="repoName"
            label="仓库英文名（可选）"
            extra="例如 monthly-report-tool；留空时系统自动生成"
            rules={[
              {
                pattern: /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
                message: '只能使用字母、数字、连字符、下划线或点号，且必须以字母或数字开头',
              },
            ]}
          >
            <Input placeholder="留空则自动生成" maxLength={100} />
          </Form.Item>
        </Form>
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
          filterOption={false}
          onSearch={(value) => void searchDevelopers(value)}
          loading={developerLoading}
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
