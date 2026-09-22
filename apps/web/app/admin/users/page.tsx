'use client';

/**
 * 用户审核页（管理员）
 * 作用：处理注册申请、管理账号状态，并查看审核通过后自动开通的 Git 账号
 */
import { UserStatusTag } from '@/components/StatusTag';
import { api } from '@/lib/api';
import { formatTime } from '@/lib/labels';
import type { Paginated, User, UserStatus } from '@/lib/types';
import { KeyOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { useCallback, useEffect, useState } from 'react';

/** 状态筛选项 */
const STATUS_OPTIONS: Array<{ label: string; value: UserStatus }> = [
  { label: '待审核', value: 'PENDING' },
  { label: '正常', value: 'ACTIVE' },
  { label: '已停用', value: 'DISABLED' },
];

export default function AdminUsersPage() {
  const [status, setStatus] = useState<UserStatus | undefined>(undefined);
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<User> | null>(null);
  const [loading, setLoading] = useState(false);

  // 审核结果（包含一次性展示的 Git 初始密码）
  const [credential, setCredential] = useState<{ name: string; username: string | null; password: string } | null>(
    null,
  );

  /** 加载用户列表 */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<Paginated<User>>('/users', { page, pageSize: 10, status, keyword }));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, status, keyword]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * 执行审核动作
   * @param user 目标用户
   * @param action 审核动作
   */
  const review = async (user: User, action: 'approve' | 'reject' | 'disable' | 'enable') => {
    try {
      const result = await api.patch<{
        message: string;
        giteaUsername?: string | null;
        giteaInitialPassword?: string | null;
      }>(`/users/${user.id}/review`, { action });
      message.success(result.message);
      if (action === 'approve') {
        setCredential({
          name: user.name,
          username: result.giteaUsername ?? null,
          password: result.giteaInitialPassword ?? '',
        });
      }
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
    }
  };

  /** 重置用户的 Git 账号密码 */
  const resetPassword = async (user: User) => {
    try {
      const result = await api.post<{ giteaUsername: string; giteaInitialPassword: string }>(
        `/users/${user.id}/reset-gitea-password`,
      );
      setCredential({ name: user.name, username: result.giteaUsername, password: result.giteaInitialPassword });
      message.success('密码已重置，请及时告知该同事');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
    }
  };

  const pendingCount = data?.items.filter((item) => item.status === 'PENDING').length ?? 0;

  return (
    <div className="page-container">
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <Typography.Title level={4} style={{ marginBottom: 0 }}>
            用户审核与管理
          </Typography.Title>
          <Typography.Text type="secondary">
            审核通过的同事会自动获得 Git 账号，可直接参与项目开发
          </Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={load}>
          刷新
        </Button>
      </Space>

      {pendingCount > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`当前页有 ${pendingCount} 位同事等待审核`}
        />
      )}

      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <Select
            allowClear
            placeholder="账号状态"
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
            prefix={<SearchOutlined />}
            placeholder="搜索姓名 / 邮箱 / 部门"
            style={{ width: 240 }}
            onPressEnter={(event) => {
              setKeyword((event.target as HTMLInputElement).value);
              setPage(1);
            }}
            onChange={(event) => {
              if (!event.target.value) {
                setKeyword('');
                setPage(1);
              }
            }}
          />
        </Space>
      </Card>

      <Table<User>
        rowKey="id"
        loading={loading}
        dataSource={data?.items ?? []}
        pagination={{
          current: page,
          pageSize: 10,
          total: data?.total ?? 0,
          showTotal: (total) => `共 ${total} 位同事`,
          onChange: (next) => setPage(next),
        }}
        columns={[
          {
            title: '姓名',
            dataIndex: 'name',
            render: (name: string, record) => (
              <Space direction="vertical" size={2}>
                <span>{name}</span>
                <span className="text-muted">{record.email}</span>
              </Space>
            ),
          },
          { title: '部门', dataIndex: 'department', width: 120, render: (v?: string | null) => v || '-' },
          { title: '状态', width: 100, render: (_, record) => <UserStatusTag status={record.status} /> },
          {
            title: '角色',
            width: 100,
            render: (_, record) => (
              <Tag color={record.role === 'ADMIN' ? 'gold' : 'default'}>
                {record.role === 'ADMIN' ? '管理员' : '员工'}
              </Tag>
            ),
          },
          {
            title: 'Git 账号',
            width: 160,
            render: (_, record) => record.giteaUsername || <span className="text-muted">未开通</span>,
          },
          {
            title: '注册时间',
            dataIndex: 'createdAt',
            width: 150,
            render: (value: string) => <span className="text-muted">{formatTime(value)}</span>,
          },
          {
            title: '操作',
            width: 220,
            fixed: 'right',
            render: (_, record) => (
              <Space size={4} wrap>
                {record.status === 'PENDING' && (
                  <>
                    <Button type="link" size="small" onClick={() => review(record, 'approve')}>
                      通过
                    </Button>
                    <Popconfirm
                      title="确认驳回该注册申请？"
                      description="驳回后该申请记录会被删除，申请人可重新提交。"
                      onConfirm={() => review(record, 'reject')}
                    >
                      <Button type="link" size="small" danger>
                        驳回
                      </Button>
                    </Popconfirm>
                  </>
                )}
                {record.status === 'ACTIVE' && record.role !== 'ADMIN' && (
                  <Popconfirm title="确认停用该账号？" onConfirm={() => review(record, 'disable')}>
                    <Button type="link" size="small" danger>
                      停用
                    </Button>
                  </Popconfirm>
                )}
                {record.status === 'DISABLED' && (
                  <Button type="link" size="small" onClick={() => review(record, 'enable')}>
                    启用
                  </Button>
                )}
                {record.giteaUsername && (
                  <Popconfirm
                    title="重置该同事的 Git 账号密码？"
                    description="重置后会生成新的临时密码，请及时线下告知。"
                    onConfirm={() => resetPassword(record)}
                  >
                    <Button type="link" size="small" icon={<KeyOutlined />}>
                      重置 Git 密码
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />

      <Modal
        open={Boolean(credential)}
        title="Git 账号信息（仅展示一次）"
        onCancel={() => setCredential(null)}
        onOk={() => setCredential(null)}
        okText="我已记录"
        cancelButtonProps={{ style: { display: 'none' } }}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="请立即复制并通过安全渠道告知该同事"
          description="该初始密码只在本次展示，首次登录后需修改密码，并上传 SSH 公钥以便推送代码。"
        />
        <Space direction="vertical" size={8}>
          <span>
            姓名：<b>{credential?.name}</b>
          </span>
          <span>
            Git 账号：<b>{credential?.username ?? '未开通'}</b>
          </span>
          <span>
            初始密码：
            <Typography.Text code copyable>
              {credential?.password || '-'}
            </Typography.Text>
          </span>
        </Space>
      </Modal>
    </div>
  );
}
