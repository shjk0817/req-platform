/**
 * 应用根布局
 * 作用：装配 Ant Design 样式注册器、登录态上下文与整体外壳
 */
import AppShell from '@/components/AppShell';
import { AuthProvider } from '@/lib/auth';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ConfigProvider } from 'antd';
import './globals.css';

export const metadata: Metadata = {
  title: '内部需求协作平台',
  description: '需求发布、认领、协作开发与反馈迭代的一体化平台',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <AntdRegistry>
          <ConfigProvider
            theme={{
              token: {
                colorPrimary: '#34785c',
                colorInfo: '#34785c',
                colorSuccess: '#34785c',
                colorWarning: '#c08532',
                colorError: '#cf2d56',
                colorText: '#26251e',
                colorTextSecondary: '#84847e',
                colorBgBase: '#f7f7f4',
                colorBgContainer: '#f2f1ed',
                colorBorder: '#cdcdc9',
                borderRadius: 4,
                borderRadiusLG: 8,
                fontFamily:
                  "'CursorGothic', 'PingFang SC', 'Microsoft YaHei', ui-sans-serif, system-ui, sans-serif",
              },
            }}
          >
            <AuthProvider>
              <AppShell>{children}</AppShell>
            </AuthProvider>
          </ConfigProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
