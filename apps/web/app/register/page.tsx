'use client';

/**
 * 注册页
 * 作用：员工填写信息提交注册申请，等待管理员审核
 * 说明：平台不区分「提需求的账号」和「开发的账号」——同一账号既能提需求，也能认领开发，
 *      因此注册信息里只收集部门与「我熟悉的方向」，不做任何身份类型上的选择
 */
import { useAuth } from '@/lib/auth';
import { LockOutlined, MailOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, Result, Select, Typography, message } from 'antd';
import Link from 'next/link';
import { useState } from 'react';

/** 可选方向标签：仅用于需求匹配提醒，不代表账号身份 */
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

export default function RegisterPage() {
  const { register } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  /** 提交注册 */
  const onFinish = async (values: {
    email: string;
    name: string;
    password: string;
    department?: string;
    skills?: string[];
  }) => {
    setLoading(true);
    setError(null);
    try {
      await register(values);
      setDone(true);
      message.success('注册申请已提交');
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败');
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Card style={{ width: 460 }}>
          <Result
            status="success"
            title="注册申请已提交"
            subTitle="管理员审核通过后即可登录，账号开通后系统会发送邮件通知。"
            extra={
              <Link href="/login">
                <Button type="primary">返回登录</Button>
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #e6f4ff 0%, #f5f6fa 100%)',
        padding: '32px 0',
      }}
    >
      <Card style={{ width: 460 }} variant="borderless">
        <Typography.Title level={3} style={{ textAlign: 'center', marginBottom: 4 }}>
          注册需求协作平台
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
          提交后需管理员审核，通过后即可发布需求或认领项目
        </Typography.Paragraph>

        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

        <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item
            name="email"
            label="公司邮箱"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '邮箱格式不正确' },
            ]}
          >
            <Input prefix={<MailOutlined />} placeholder="name@example.com" size="large" />
          </Form.Item>
          <Form.Item
            name="name"
            label="姓名"
            rules={[{ required: true, min: 2, max: 32, message: '请输入 2-32 个字符的姓名' }]}
          >
            <Input prefix={<UserOutlined />} placeholder="请输入真实姓名" size="large" />
          </Form.Item>
          <Form.Item name="department" label="所属部门">
            <Input prefix={<TeamOutlined />} placeholder="例如：生产部（选填）" size="large" />
          </Form.Item>
          <Form.Item
            name="password"
            label="登录密码"
            rules={[{ required: true, min: 8, message: '密码至少 8 位' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="至少 8 位" size="large" />
          </Form.Item>
          <Form.Item
            name="skills"
            label="我能帮上的方向"
            extra="填上你熟悉或愿意参与的方向，例如前端、报表、自动化；有相关需求时会通知你（选填）"
          >
            <Select
              mode="tags"
              placeholder="选择或输入你的技能"
              options={SKILL_OPTIONS.map((item) => ({ label: item, value: item }))}
              size="large"
            />
          </Form.Item>
          <Form.Item style={{ marginBottom: 8 }}>
            <Button type="primary" htmlType="submit" size="large" block loading={loading}>
              提交注册申请
            </Button>
          </Form.Item>
        </Form>

        <Typography.Paragraph style={{ textAlign: 'center', marginBottom: 0 }}>
          已有账号？<Link href="/login">返回登录</Link>
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
