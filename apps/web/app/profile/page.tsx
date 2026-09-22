'use client';

/**
 * 个人资料页
 * 作用：维护姓名、部门、能力标签与头像，展示个人协作热力图，并支持修改登录密码
 */
import AvatarBadge from '@/components/AvatarBadge';
import AvatarPicker from '@/components/AvatarPicker';
import Heatmap from '@/components/Heatmap';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { USER_AVATARS } from '@/lib/avatars';
import { formatTime } from '@/lib/labels';
import type { HeatmapData, User } from '@/lib/types';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  Row,
  Select,
  Space,
  Statistic,
  Typography,
  message,
} from 'antd';
import { useCallback, useEffect, useState } from 'react';

/** 可选能力标签候选 */
const SKILL_OPTIONS = [
  '前端',
  '后端',
  'Node.js',
  'Python',
  'Java',
  'Go',
  '数据库',
  '测试',
  '运维',
  '数据分析',
  '报表',
  '自动化',
  'Android',
  'iOS',
];

/** 表单字段结构 */
interface ProfileFormValues {
  name?: string;
  department?: string;
  skills?: string[];
  avatarUrl?: string | null;
}

export default function ProfilePage() {
  const { user, refresh } = useAuth();
  const [profileForm] = Form.useForm<ProfileFormValues>();
  const [passwordForm] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [changing, setChanging] = useState(false);
  const [heatmap, setHeatmap] = useState<HeatmapData | null>(null);
  const [heatmapLoading, setHeatmapLoading] = useState(false);

  // 表单里的头像实时预览：未改动时回退到已保存的头像
  const watchedAvatar = Form.useWatch<string | null | undefined>('avatarUrl', profileForm);
  const avatarPreview = watchedAvatar === undefined ? user?.avatarUrl ?? null : watchedAvatar;

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

  // 用户信息就绪后同步表单初值
  useEffect(() => {
    profileForm.setFieldsValue({
      name: user?.name,
      department: user?.department ?? undefined,
      skills: user?.skills ?? [],
      avatarUrl: user?.avatarUrl ?? undefined,
    });
  }, [user, profileForm]);

  /** 保存个人资料 */
  const saveProfile = async (values: ProfileFormValues) => {
    setSaving(true);
    try {
      await api.put<User>('/users/profile', values);
      await refresh();
      message.success('资料已更新');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  /** 修改密码 */
  const changePassword = async (values: { oldPassword: string; newPassword: string }) => {
    setChanging(true);
    try {
      await api.put('/auth/password', values);
      passwordForm.resetFields();
      message.success('密码修改成功，请使用新密码重新登录');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '修改失败');
    } finally {
      setChanging(false);
    }
  };

  return (
    <div className="page-container" style={{ maxWidth: 1100 }}>
      <Space size={16} style={{ marginBottom: 16 }}>
        <AvatarBadge value={user?.avatarUrl} name={user?.name} size={56} />
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
            <Form
              form={profileForm}
              layout="vertical"
              onFinish={saveProfile}
              initialValues={{ avatarUrl: user?.avatarUrl ?? undefined }}
            >
              <Form.Item
                name="avatarUrl"
                label="我的头像"
                extra="点击「更换头像」挑选一个，选好后点「保存修改」生效"
              >
                <AvatarPicker presets={USER_AVATARS} name={user?.name} />
              </Form.Item>
              <Form.Item name="name" label="姓名" rules={[{ max: 32, message: '姓名最多 32 个字符' }]}>
                <Input placeholder="请输入姓名" />
              </Form.Item>
              <Form.Item name="department" label="所属部门">
                <Input placeholder="例如：生产部" />
              </Form.Item>
              <Form.Item
                name="skills"
                label="我能帮上的方向"
                extra="填上你熟悉或愿意参与的方向，有相关标签的新需求发布时会通知你，也方便同事找到你"
              >
                <Select
                  mode="tags"
                  placeholder="选择或输入你的技能"
                  options={SKILL_OPTIONS.map((item) => ({ label: item, value: item }))}
                />
              </Form.Item>
              <Space>
                <Button type="primary" htmlType="submit" loading={saving}>
                  保存修改
                </Button>
                <Button
                  onClick={() => {
                    profileForm.setFieldsValue({ avatarUrl: null });
                  }}
                >
                  清除头像
                </Button>
                <Space size={6}>
                  <span className="text-muted">当前效果：</span>
                  <AvatarBadge value={avatarPreview} name={user?.name} size={28} />
                </Space>
              </Space>
            </Form>
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card title="账号信息" style={{ marginBottom: 16 }}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="邮箱">{user?.email}</Descriptions.Item>
              <Descriptions.Item label="角色">{user?.role === 'ADMIN' ? '管理员' : '员工'}</Descriptions.Item>
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
          </Card>

          <Card title="修改密码">
            <Form form={passwordForm} layout="vertical" onFinish={changePassword}>
              <Form.Item
                name="oldPassword"
                label="原密码"
                rules={[{ required: true, message: '请输入原密码' }]}
              >
                <Input.Password placeholder="请输入原密码" />
              </Form.Item>
              <Form.Item
                name="newPassword"
                label="新密码"
                rules={[{ required: true, min: 8, message: '新密码至少 8 位' }]}
              >
                <Input.Password placeholder="至少 8 位" />
              </Form.Item>
              <Space>
                <Button type="primary" htmlType="submit" loading={changing}>
                  修改密码
                </Button>
              </Space>
            </Form>
          </Card>
        </Col>
      </Row>

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
    </div>
  );
}
