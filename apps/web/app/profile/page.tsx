'use client';

/**
 * 个人资料页
 * 作用：展示个人摘要与协作热力图，头像和密码通过弹窗维护
 */
import AvatarBadge from '@/components/AvatarBadge';
import AvatarPicker from '@/components/AvatarPicker';
import Heatmap from '@/components/Heatmap';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { USER_AVATARS } from '@/lib/avatars';
import { formatTime } from '@/lib/labels';
import type { HeatmapData, IntegrationTokenSummary, User } from '@/lib/types';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Divider,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Row,
  Space,
  Statistic,
  Tag,
  Typography,
  message,
} from 'antd';
import { useCallback, useEffect, useState } from 'react';

/** 表单字段结构 */
interface ProfileFormValues {
  avatarUrl?: string | null;
}

/** 新建机器令牌表单 */
interface IntegrationTokenFormValues {
  name: string;
  scopes: string[];
  expiresInDays?: number;
}

/** 新建机器令牌响应 */
interface CreatedIntegrationToken {
  token: string;
  tokenId: string;
  name: string;
  scopes: string[];
  expiresAt: string | null;
  message: string;
}

export default function ProfilePage() {
  const { user, refresh } = useAuth();
  const [avatarForm] = Form.useForm<ProfileFormValues>();
  const [passwordForm] = Form.useForm();
  const [changing, setChanging] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [heatmap, setHeatmap] = useState<HeatmapData | null>(null);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [integrationTokens, setIntegrationTokens] = useState<IntegrationTokenSummary[]>([]);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [tokenForm] = Form.useForm<IntegrationTokenFormValues>();
  const [creatingToken, setCreatingToken] = useState(false);
  const [createdToken, setCreatedToken] = useState<CreatedIntegrationToken | null>(null);

  /** 加载个人协作热力图 */
  const loadHeatmap = useCallback(async () => {
    if (!user?.id) {
      return;
    }
    setHeatmapLoading(true);
    try {
      const data = await api.get<HeatmapData>('/stats/heatmap', { userId: user.id, months: 12 });
      setHeatmap(data);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '热力图加载失败');
    } finally {
      setHeatmapLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void loadHeatmap();
  }, [loadHeatmap]);

  /** 加载当前用户的 CLI / MCP 令牌摘要 */
  const loadIntegrationTokens = useCallback(async () => {
    if (!user?.id) {
      return;
    }
    try {
      setIntegrationTokens(await api.get<IntegrationTokenSummary[]>('/integrations/tokens'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '令牌列表加载失败');
    }
  }, [user?.id]);

  useEffect(() => {
    void loadIntegrationTokens();
  }, [loadIntegrationTokens]);

  // 用户信息就绪后同步头像弹窗初值
  useEffect(() => {
    avatarForm.setFieldsValue({ avatarUrl: user?.avatarUrl ?? null });
  }, [user, avatarForm]);

  /** 保存头像设置 */
  const saveAvatar = async (values: ProfileFormValues) => {
    try {
      const isPreset = USER_AVATARS.some((preset) => preset.key === values.avatarUrl);
      if (!values.avatarUrl || isPreset) {
        await api.put<User>('/users/profile', { avatarUrl: values.avatarUrl ?? null });
      }
      await refresh();
      setAvatarOpen(false);
      message.success('头像已更新');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '头像保存失败');
    }
  };

  /** 修改密码 */
  const changePassword = async (values: { oldPassword: string; newPassword: string }) => {
    setChanging(true);
    try {
      await api.put('/auth/password', values);
      passwordForm.resetFields();
      setPasswordOpen(false);
      message.success('密码修改成功，请使用新密码重新登录');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '修改失败');
    } finally {
      setChanging(false);
    }
  };

  /** 创建机器令牌，明文只在当前页面显示一次 */
  const createIntegrationToken = async (values: IntegrationTokenFormValues) => {
    setCreatingToken(true);
    try {
      const created = await api.post<CreatedIntegrationToken>('/integrations/tokens', values);
      setCreatedToken(created);
      setTokenOpen(false);
      tokenForm.resetFields();
      await loadIntegrationTokens();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '令牌创建失败');
    } finally {
      setCreatingToken(false);
    }
  };

  /** 撤销一个机器令牌 */
  const revokeIntegrationToken = async (tokenId: string) => {
    try {
      await api.delete(`/integrations/tokens/${tokenId}`);
      await loadIntegrationTokens();
      message.success('令牌已撤销');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '令牌撤销失败');
    }
  };

  return (
    <div className="page-container" style={{ maxWidth: 1100 }}>
      <Space size={16} style={{ marginBottom: 16 }}>
        <Button
          type="text"
          aria-label="设置头像"
          onClick={() => {
            avatarForm.setFieldsValue({ avatarUrl: user?.avatarUrl ?? null });
            setAvatarOpen(true);
          }}
          style={{ padding: 0, height: 'auto', borderRadius: '50%' }}
        >
          <AvatarBadge value={user?.avatarUrl} name={user?.name} size={56} />
        </Button>
        <Space direction="vertical" size={0}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {user?.name}
          </Typography.Title>
          <Typography.Text type="secondary">
            {user?.department || '未填写部门'} · 加入于 {formatTime(user?.createdAt)}
          </Typography.Text>
        </Space>
      </Space>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card title="基本信息">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="姓名">{user?.name}</Descriptions.Item>
              <Descriptions.Item label="部门">{user?.department || '未填写'}</Descriptions.Item>
              <Descriptions.Item label="邮箱">{user?.email}</Descriptions.Item>
              <Descriptions.Item label="角色">{user?.role === 'ADMIN' ? '管理员' : '员工'}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card title="账号信息">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="Git 账号">{user?.giteaUsername ?? '未开通'}</Descriptions.Item>
              <Descriptions.Item label="注册时间">{formatTime(user?.createdAt)}</Descriptions.Item>
            </Descriptions>
            {!user?.giteaUsername && (
              <Alert
                type="info"
                showIcon
                style={{ marginTop: 12 }}
                message="Git 账号尚未开通"
                description="请联系管理员确认账号审核状态，开通后即可推送代码。"
              />
            )}
            <Button style={{ marginTop: 16 }} onClick={() => setPasswordOpen(true)}>
              修改密码
            </Button>
          </Card>
        </Col>
      </Row>

      <Card
        title="AI 工具访问"
        extra={
          <Button type="primary" onClick={() => setTokenOpen(true)}>
            创建访问令牌
          </Button>
        }
        style={{ marginTop: 16 }}
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          用于 CLI、MCP 或其他 AI 工具调用平台。令牌只显示一次，请保存到系统钥匙串，不要粘贴到代码仓库。
        </Typography.Paragraph>
        <List
          size="small"
          dataSource={integrationTokens}
          locale={{ emptyText: '还没有访问令牌' }}
          renderItem={(token) => (
            <List.Item
              actions={[
                token.revokedAt ? (
                  <Tag key="revoked" color="default">已撤销</Tag>
                ) : (
                  <Popconfirm
                    key="revoke"
                    title="撤销这个访问令牌？"
                    description="使用该令牌的 CLI / MCP 将立即无法调用平台。"
                    onConfirm={() => void revokeIntegrationToken(token.id)}
                    okText="撤销"
                    cancelText="取消"
                  >
                    <Button danger type="link">撤销</Button>
                  </Popconfirm>
                ),
              ]}
            >
              <List.Item.Meta
                title={<Space><Typography.Text strong>{token.name}</Typography.Text><Typography.Text code>{token.tokenPrefix}…</Typography.Text></Space>}
                description={
                  <Space wrap size={4}>
                    {token.scopes.map((scope) => <Tag key={scope}>{scope}</Tag>)}
                    <Typography.Text type="secondary">
                      {token.expiresAt ? `有效期至 ${formatTime(token.expiresAt)}` : '不过期'}
                    </Typography.Text>
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </Card>

      <Card
        title="我的协作热力图"
        extra={<span className="text-muted">近 12 个月</span>}
        style={{ marginTop: 16 }}
      >
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={12} md={6}>
            <Statistic title="累计协作行为" value={heatmap?.total ?? 0} />
          </Col>
          <Col xs={12} md={6}>
            <Statistic title="提出需求" value={heatmap?.summary.projects ?? 0} />
          </Col>
          <Col xs={12} md={6}>
            <Statistic title="认领项目" value={heatmap?.summary.claims ?? 0} />
          </Col>
          <Col xs={12} md={6}>
            <Statistic title="提交反馈 / 评论" value={(heatmap?.summary.feedbacks ?? 0) + (heatmap?.summary.comments ?? 0)} />
          </Col>
        </Row>
        <Heatmap data={heatmap} loading={heatmapLoading} />
      </Card>

      <Modal
        open={avatarOpen}
        title="设置头像"
        okText="保存头像"
        onCancel={() => setAvatarOpen(false)}
        footer={null}
      >
        <Form form={avatarForm} layout="vertical" onFinish={saveAvatar}>
          <Form.Item name="avatarUrl" noStyle>
            <AvatarPicker presets={USER_AVATARS} name={user?.name} />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit">保存头像</Button>
            <Button onClick={() => avatarForm.setFieldsValue({ avatarUrl: null })}>清除头像</Button>
          </Space>
        </Form>
      </Modal>

      <Modal
        open={tokenOpen}
        title="创建 AI 工具访问令牌"
        okText="创建令牌"
        confirmLoading={creatingToken}
        onCancel={() => {
          tokenForm.resetFields();
          setTokenOpen(false);
        }}
        onOk={() => void tokenForm.submit()}
      >
        <Form
          form={tokenForm}
          layout="vertical"
          initialValues={{ scopes: ['read'], expiresInDays: 90 }}
          onFinish={createIntegrationToken}
        >
          <Form.Item name="name" label="用途名称" rules={[{ required: true, message: '请输入用途名称' }]}>
            <Input placeholder="例如：我的 Cursor 助手" maxLength={80} />
          </Form.Item>
          <Form.Item name="scopes" label="权限范围" rules={[{ required: true, message: '至少选择一项权限' }]}>
            <Checkbox.Group
              options={[
                { label: '读取平台数据', value: 'read' },
                { label: '发布或认领需求', value: 'project:write' },
                { label: '提交反馈与评论', value: 'feedback:write' },
                { label: '读取 Git 元数据', value: 'git:metadata' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="expiresInDays"
            label="有效天数"
            extra="留空表示不过期；建议使用 90 天并定期轮换。"
            rules={[{ type: 'number', min: 1, max: 3650, message: '请输入 1-3650 天' }]}
          >
            <Input type="number" placeholder="90" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(createdToken)}
        title="请立即保存访问令牌"
        footer={[
          <Button
            key="copy"
            type="primary"
            onClick={() => {
              if (createdToken) {
                void navigator.clipboard.writeText(createdToken.token);
                message.success('令牌已复制');
              }
            }}
          >
            复制令牌
          </Button>,
          <Button key="close" onClick={() => setCreatedToken(null)}>我已保存</Button>,
        ]}
        onCancel={() => setCreatedToken(null)}
      >
        <Alert type="warning" showIcon message={createdToken?.message} />
        <Divider />
        <Input.Password value={createdToken?.token} readOnly visibilityToggle={false} />
      </Modal>

      <Modal
        open={passwordOpen}
        title="修改密码"
        okText="保存密码"
        onCancel={() => {
          passwordForm.resetFields();
          setPasswordOpen(false);
        }}
        footer={null}
      >
        <Form form={passwordForm} layout="vertical" onFinish={changePassword}>
          <Form.Item name="oldPassword" label="原密码" rules={[{ required: true, message: '请输入原密码' }]}>
            <Input.Password placeholder="请输入原密码" />
          </Form.Item>
          <Form.Item name="newPassword" label="新密码" rules={[{ required: true, min: 8, message: '新密码至少 8 位' }]}>
            <Input.Password placeholder="至少 8 位" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={changing} block>
            保存密码
          </Button>
        </Form>
      </Modal>
    </div>
  );
}
