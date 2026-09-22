'use client';

/**
 * 应用外壳组件
 * 作用：提供侧边导航、顶栏用户信息，并对未登录访问做统一拦截
 */
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { openGitea } from '@/lib/gitea';
import AvatarBadge from '@/components/AvatarBadge';
import {
  AppstoreOutlined,
  BellOutlined,
  BugOutlined,
  DashboardOutlined,
  GithubOutlined,
  LogoutOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Badge, Button, Dropdown, Layout, Menu, Space, Spin, Tooltip, Typography } from 'antd';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';

const { Header, Sider, Content } = Layout;

/** 无需登录即可访问的路径 */
const PUBLIC_PATHS = ['/login', '/register'];

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, ready, isAdmin, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [unread, setUnread] = useState(0);

  const isPublicPage = PUBLIC_PATHS.some((path) => pathname?.startsWith(path));

  // 未登录时跳转到登录页
  useEffect(() => {
    if (ready && !user && !isPublicPage) {
      router.replace(`/login?redirect=${encodeURIComponent(pathname ?? '/')}`);
    }
  }, [ready, user, isPublicPage, pathname, router]);

  // 轮询未读通知数量
  useEffect(() => {
    if (!user) {
      setUnread(0);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const result = await api.get<{ count: number }>('/notifications/unread-count');
        if (!cancelled) {
          setUnread(result.count);
        }
      } catch {
        // 忽略轮询失败
      }
    };
    void load();
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user]);

  // 公开页面直接渲染，不套用外壳
  if (isPublicPage) {
    return <>{children}</>;
  }

  if (!ready || !user) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" tip="正在加载平台..." />
      </div>
    );
  }

  /** 侧边导航项（发布需求的入口统一放在需求池页，避免重复） */
  const menuItems = [
    { key: '/', icon: <DashboardOutlined />, label: '工作台' },
    { key: '/projects', icon: <AppstoreOutlined />, label: '需求池' },
    { key: '/feedbacks', icon: <BugOutlined />, label: '反馈中心' },
    { key: '/notifications', icon: <BellOutlined />, label: '消息通知' },
    { key: '/profile', icon: <UserOutlined />, label: '个人资料' },
    ...(isAdmin ? [{ key: '/admin/users', icon: <TeamOutlined />, label: '用户审核' }] : []),
  ];

  /** 当前选中的菜单项：优先匹配更长的前缀 */
  const selectedKey =
    menuItems
      .map((item) => item.key)
      .filter((key) => key !== '/' && pathname?.startsWith(key))
      .sort((a, b) => b.length - a.length)[0] ?? '/';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth="0" theme="light" width={216}>
        <div style={{ padding: '18px 20px', fontSize: 16, fontWeight: 600, color: '#1677ff' }}>
          需求协作平台
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => router.push(key)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}
        >
          <Space size={20}>
            <Tooltip title="打开 Git 服务（平台会自动完成登录）">
              <Button type="text" icon={<GithubOutlined />} onClick={() => void openGitea()}>
                代码仓库
              </Button>
            </Tooltip>
            <Badge count={unread} size="small">
              <BellOutlined
                style={{ fontSize: 18, cursor: 'pointer' }}
                onClick={() => router.push('/notifications')}
              />
            </Badge>
            <Dropdown
              menu={{
                items: [
                  { key: 'profile', label: '个人资料', onClick: () => router.push('/profile') },
                  {
                    key: 'logout',
                    icon: <LogoutOutlined />,
                    label: '退出登录',
                    onClick: () => {
                      logout();
                      router.replace('/login');
                    },
                  },
                ],
              }}
            >
              <Space style={{ cursor: 'pointer' }}>
                <AvatarBadge value={user.avatarUrl} name={user.name} size={28} />
                <Typography.Text>{user.name}</Typography.Text>
                {isAdmin && <Typography.Text type="secondary">（管理员）</Typography.Text>}
              </Space>
            </Dropdown>
          </Space>
        </Header>
        <Content>{children}</Content>
      </Layout>
    </Layout>
  );
}
