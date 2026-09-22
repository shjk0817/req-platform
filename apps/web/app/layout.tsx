/**
 * 应用根布局
 * 作用：装配 Ant Design 样式注册器、登录态上下文与整体外壳
 */
import AppShell from '@/components/AppShell';
import { AuthProvider } from '@/lib/auth';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
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
          <AuthProvider>
            <AppShell>{children}</AppShell>
          </AuthProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
