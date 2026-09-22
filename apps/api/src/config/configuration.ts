/**
 * 应用配置加载器
 * 作用：集中读取环境变量并做类型转换与默认值兜底，供 ConfigService 使用
 */
export default () => ({
  /** 运行环境 */
  env: process.env.NODE_ENV ?? 'development',
  /** 服务监听端口 */
  port: Number(process.env.PORT ?? 4000),
  /** 平台对外地址，用于生成邮件与通知中的链接 */
  appUrl: process.env.APP_URL ?? 'http://app.localhost',
  /** 容器内部自身地址，用于生成 Gitea Webhook 回调地址 */
  selfInternalUrl: process.env.SELF_INTERNAL_URL ?? 'http://api:4000',

  /** 数据库连接串 */
  databaseUrl: process.env.DATABASE_URL,

  /** Redis 配置（BullMQ 队列） */
  redis: {
    host: process.env.REDIS_HOST ?? 'redis',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  /** JWT 认证配置 */
  jwt: {
    secret: process.env.JWT_SECRET ?? 'dev-only-secret-please-change-it',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  },

  /** 本地开发账号选择器配置：生产环境不会暴露账号与开发密码 */
  devPicker: {
    enabled: (process.env.DEV_USER_PICKER_ENABLED ?? 'false') === 'true',
    adminPassword: process.env.DEV_PICKER_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD ?? 'Admin@123456',
    userPassword: process.env.DEV_PICKER_USER_PASSWORD ?? process.env.DEMO_PASSWORD ?? 'Demo@123456',
  },

  /** Gitea 集成配置 */
  gitea: {
    /** 容器内网访问地址（服务端调用 API 使用） */
    internalUrl: process.env.GITEA_INTERNAL_URL ?? 'http://gitea:3000',
    /** 对外根地址（生成给用户点击的链接） */
    rootUrl: process.env.GITEA_ROOT_URL ?? 'http://git.localhost/',
    /** 存放所有项目仓库的组织名 */
    org: process.env.GITEA_ORG ?? 'projects',
    /** 对外 SSH clone 端口 */
    sshPort: Number(process.env.GITEA_SSH_PORT ?? 2222),
    /** 平台调用 Gitea API 的令牌 */
    apiToken: process.env.GITEA_API_TOKEN ?? '',
    /** Webhook 签名密钥 */
    webhookSecret: process.env.GITEA_WEBHOOK_SECRET ?? '',
    /** Gitea 站点管理员账号名：初始管理员会绑定该账号，从而直接免密进入 Git 服务 */
    adminUser: process.env.GITEA_ADMIN_USER ?? 'gitea-admin',
  },

  /** 流水线状态回调配置（Gitea 1.22 无法订阅流水线事件，由工作流主动回调平台） */
  ci: {
    callbackToken: process.env.CI_CALLBACK_TOKEN || process.env.GITEA_WEBHOOK_SECRET || '',
  },

  /** 附件与图片上传配置 */
  upload: {
    /** 落盘目录（容器内路径，由 docker volume 持久化） */
    dir: process.env.UPLOAD_DIR ?? '/app/uploads',
    /** 单个上传文件大小上限（MB），内容类型不做白名单限制 */
    maxMb: Number(process.env.UPLOAD_MAX_MB ?? 100),
    /** 自定义头像大小上限（MB），头像接口只接受图片 */
    avatarMaxMb: Number(process.env.AVATAR_MAX_MB ?? 5),
  },

  /** 邮件通知配置 */
  mail: {
    enabled: (process.env.MAIL_ENABLED ?? 'false') === 'true',
    host: process.env.MAIL_HOST ?? '',
    port: Number(process.env.MAIL_PORT ?? 465),
    secure: (process.env.MAIL_SECURE ?? 'true') === 'true',
    user: process.env.MAIL_USER ?? '',
    password: process.env.MAIL_PASSWORD ?? '',
    from: process.env.MAIL_FROM ?? '需求协作平台 <noreply@example.com>',
  },

  /** 初始管理员账号：仅在平台中不存在任何管理员时自动创建 */
  admin: {
    email: process.env.ADMIN_EMAIL ?? 'admin@example.com',
    password: process.env.ADMIN_PASSWORD ?? 'Admin@123456',
    name: process.env.ADMIN_NAME ?? '平台管理员',
  },
});
