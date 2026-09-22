'use client';

/**
 * 应用外壳组件
 * 作用：提供编辑型顶栏导航、用户操作区，并对未登录访问做统一拦截
 */
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { openGitea } from '@/lib/gitea';
import AvatarBadge from '@/components/AvatarBadge';
import GuidePopover from '@/components/GuidePopover';
import { getPageGuide } from '@/lib/guides';
import {
  AppstoreOutlined,
  BellOutlined,
  BugOutlined,
  DashboardOutlined,
  GithubOutlined,
  LogoutOutlined,
  MenuOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Badge, Button, Drawer, Dropdown, Layout, Menu, Space, Spin, Tooltip, Typography } from 'antd';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';

const { Header, Content } = Layout;

/** 无需登录即可访问的路径 */
const PUBLIC_PATHS = ['/login', '/register'];

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, ready, isAdmin, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isPublicPage = PUBLIC_PATHS.some((path) => pathname?.startsWith(path));
  const pageGuide = pathname ? getPageGuide(pathname) : null;
  const pageTitle =
    pathname === '/'
      ? '工作台'
      : pathname === '/projects'
        ? '需求池'
        : pathname === '/projects/new'
          ? '写下一条需求'
            : pathname?.includes('/deliverables')
              ? '成果中心'
          : pathname?.startsWith('/projects/')
            ? '需求详情'
            : pathname?.startsWith('/feedbacks')
              ? '反馈中心'
              : pathname?.startsWith('/notifications')
                ? '消息通知'
                : pathname?.startsWith('/admin')
                  ? '用户审核'
                  : '个人资料';

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

  /** 顶栏导航项（发布需求的入口统一放在需求池页，避免重复） */
  const menuItems = [
    { key: '/', icon: <DashboardOutlined />, label: '工作台' },
    { key: '/projects', icon: <AppstoreOutlined />, label: '需求池' },
    { key: '/feedbacks', icon: <BugOutlined />, label: '反馈中心' },
    {
      key: '/notifications',
      icon: <BellOutlined />,
      label: <Badge count={unread} size="small" offset={[8, 0]}>消息通知</Badge>,
    },
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
    <Layout className="app-layout">
      <Header className="app-header">
        <div className="app-brand">
          <span className="app-brand-mark">需</span>
          <div>
            <Typography.Text className="app-brand-name">需求协作平台</Typography.Text>
            <Typography.Text className="app-brand-kicker">WORKFLOW ATELIER</Typography.Text>
          </div>
        </div>
        <Menu
          className="top-nav-menu"
          mode="horizontal"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => router.push(key)}
        />
        <div className="header-actions">
          <Tooltip title="只有需要修改代码的同事才需要打开这里，平台会自动完成登录">
            <Button className="code-repository-button" type="text" icon={<GithubOutlined />} onClick={() => void openGitea()}>
              给开发同事的代码库
            </Button>
          </Tooltip>
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
            <Space className="user-menu-trigger">
              <AvatarBadge value={user.avatarUrl} name={user.name} size={30} />
              <span className="user-menu-name">{user.name}</span>
              {isAdmin && <span className="user-menu-role">管理员</span>}
            </Space>
          </Dropdown>
          <Button
            className="mobile-nav-trigger"
            type="text"
            icon={<MenuOutlined />}
            aria-label="打开导航菜单"
            onClick={() => setMobileMenuOpen(true)}
          />
        </div>
      </Header>
      <Drawer
        title="平台导航"
        placement="right"
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        className="mobile-nav-drawer"
      >
        <Menu
          mode="vertical"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => {
            setMobileMenuOpen(false);
            router.push(key);
          }}
        />
      </Drawer>
      <Content className="app-content">
        <div className="page-heading">
          <span className="page-heading-kicker">CURRENT VIEW</span>
          <Typography.Title level={1}>{pageTitle}</Typography.Title>
        </div>
        {children}
        {pageGuide && pathname && (
          <GuidePopover
            guide={pageGuide}
            storageKey={`aimanager_guide_${pathname.replaceAll('/', '_') || 'home'}`}
          />
        )}
      </Content>
    </Layout>
  );
}
