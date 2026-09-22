/**
 * Next.js 配置
 * 说明：standalone 输出用于生成体积更小的容器镜像
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // 通过 Caddy 同域反向代理访问后端，无需额外跨域配置
  async rewrites() {
    return [];
  },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
