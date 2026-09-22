'use client';

/**
 * 登录页
 * 作用：员工使用邮箱与密码登录平台
 * 说明：
 *   1. 登录成功后一律回「工作台」（/），只有明确带回跳地址时才跳回原页面；
 *   2. 已登录的同事访问登录页会直接被送回工作台，不会停在登录表单上；
 *   3. 回跳地址是站外地址（典型场景：从 Git 服务被弹回来）时，
 *      先签发 Git 免密 Cookie 再跳转，保证回去后是已登录状态。
 */
import { DEV_USER_PICKER_ENABLED, type DevPickerUser, useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { isExternalUrl, redirectToExternal } from '@/lib/gitea';
import { LockOutlined, MailOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, Select, Typography, message } from 'antd';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';

/** 登录表单内容（独立组件以便使用 useSearchParams） */
function LoginForm() {
  const { user, ready, login } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [form] = Form.useForm<{ email: string; password: string }>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devUsers, setDevUsers] = useState<DevPickerUser[]>([]);
  const [devUsersLoading, setDevUsersLoading] = useState(false);
  const [selectedDevUserId, setSelectedDevUserId] = useState<string>();

  /** 开发环境加载可选账号，生产构建不会显示该入口 */
  useEffect(() => {
    if (!DEV_USER_PICKER_ENABLED) {
      return;
    }
    setDevUsersLoading(true);
    void api
      .get<DevPickerUser[]>('/auth/dev-users')
      .then(setDevUsers)
      .catch(() => {
        setError('开发账号列表加载失败，请检查后端是否处于开发模式');
      })
      .finally(() => setDevUsersLoading(false));
  }, []);

  /** 回跳地址：为空、指回登录页或工作台时统一落到工作台 */
  const resolveRedirect = useCallback((): string => {
    const raw = params.get('redirect');
    if (!raw || raw === '/' || raw.startsWith('/login')) {
      return '/';
    }
    return raw;
  }, [params]);

  /** 登录后的统一落点处理 */
  const gotoAfterLogin = useCallback(
    async (showSuccess: boolean) => {
      const target = resolveRedirect();
      if (isExternalUrl(target)) {
        // 站外地址（Git 服务）：先签发免密 Cookie，再跳回去
        await redirectToExternal(target);
        return;
      }
      if (showSuccess) {
        message.success('登录成功');
      }
      router.replace(target);
    },
    [resolveRedirect, router],
  );

  // 已登录用户访问登录页时直接回工作台
  useEffect(() => {
    if (!ready || !user) {
      return;
    }
    void gotoAfterLogin(false);
  }, [ready, user, gotoAfterLogin]);

  /** 提交登录 */
  const onFinish = async (values: { email: string; password: string }) => {
    setLoading(true);
    setError(null);
    try {
      await login(values.email, values.password);
      await gotoAfterLogin(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  /** 选择开发账号后填充邮箱和密码，最终仍提交普通登录表单 */
  const onSelectDevUser = (userId: string) => {
    const selected = devUsers.find((item) => item.id === userId);
    if (!selected) {
      return;
    }
    setSelectedDevUserId(userId);
    form.setFieldsValue({ email: selected.email, password: selected.password });
    setError(null);
  };

  return (
    <div className="auth-page">
      <Card className="auth-card" style={{ width: 400 }} variant="borderless">
        <Typography.Title level={3} style={{ textAlign: 'center', marginBottom: 4 }}>
          内部需求协作平台
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
          提需求 · 认领开发 · 协作交付 · 反馈迭代
        </Typography.Paragraph>

        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

        <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item
            name="email"
            label="邮箱"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '邮箱格式不正确' },
            ]}
          >
            <Input
              prefix={<MailOutlined />}
              placeholder="name@example.com"
              size="large"
              addonAfter={
                DEV_USER_PICKER_ENABLED ? (
                  <Select
                    aria-label="选择开发账号"
                    allowClear
                    loading={devUsersLoading}
                    placeholder="选择开发账号"
                    value={selectedDevUserId}
                    onChange={onSelectDevUser}
                    options={devUsers.map((item) => ({
                      value: item.id,
                      label: `${item.name}（${item.role === 'ADMIN' ? '管理员' : '普通用户'}）`,
                    }))}
                    style={{ width: 168 }}
                  />
                ) : undefined
              }
            />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="请输入密码" size="large" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 8 }}>
            <Button type="primary" htmlType="submit" size="large" block loading={loading}>
              登录
            </Button>
          </Form.Item>
        </Form>

        <Typography.Paragraph style={{ textAlign: 'center', marginBottom: 0 }}>
          还没有账号？<Link href="/register">立即注册</Link>
        </Typography.Paragraph>
        {DEV_USER_PICKER_ENABLED && (
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, textAlign: 'center' }}>
            选择开发账号后会自动填充账号和密码，再点击「登录」
          </Typography.Paragraph>
        )}
      </Card>
    </div>
  );
}

/** 页面出口：用 Suspense 包裹以支持 useSearchParams */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
