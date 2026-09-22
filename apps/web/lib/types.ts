/**
 * 平台前端类型定义
 * 作用：与后端 API 返回结构保持一致，供页面与组件复用
 */

/** 用户角色 */
export type Role = 'EMPLOYEE' | 'ADMIN';
/** 用户状态 */
export type UserStatus = 'PENDING' | 'ACTIVE' | 'DISABLED';
/** 项目状态 */
export type ProjectStatus = 'OPEN' | 'CLAIMED' | 'DEVELOPING' | 'RELEASED' | 'CLOSED';
/** 反馈类型 */
export type FeedbackType = 'BUG' | 'IMPROVEMENT' | 'QUESTION';
/** 反馈状态 */
export type FeedbackStatus = 'OPEN' | 'PROCESSING' | 'RESOLVED' | 'CLOSED';

/** 当前登录用户 */
export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  department?: string | null;
  skills: string[];
  avatarUrl?: string | null;
  giteaUsername?: string | null;
  createdAt?: string;
}

/** 简要用户信息 */
export interface UserBrief {
  id: string;
  name: string;
  email?: string;
  department?: string | null;
  skills?: string[];
  avatarUrl?: string | null;
  giteaUsername?: string | null;
}

/** 共同需求人 */
export interface ProjectRequester {
  id: string;
  createdAt: string;
  user: UserBrief;
}

/** 分页返回结构 */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** 项目（需求） */
export interface Project {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria?: string | null;
  tags: string[];
  /** 任务头像标识（如 task-01） */
  avatar?: string | null;
  status: ProjectStatus;
  /** 完成度百分比，由后端按状态与 PR 合并情况计算 */
  progress?: number;
  expectedAt?: string | null;
  creatorId: string;
  ownerId?: string | null;
  repoOwner?: string | null;
  repoName?: string | null;
  repoUrl?: string | null;
  claimedAt?: string | null;
  releasedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  creator?: UserBrief;
  owner?: UserBrief | null;
  /** 共同需求人（需求方之外的同事） */
  requesters?: ProjectRequester[];
  /** 需求图片（可预览） */
  images?: Attachment[];
  /** 需求附件（可下载） */
  files?: Attachment[];
  /** 附件总数（列表页用于提示） */
  attachmentCount?: number;
  members?: Array<{ id: string; role: 'OWNER' | 'COLLABORATOR'; user: UserBrief }>;
  claims?: Array<{ id: string; remark?: string | null; createdAt: string; user: UserBrief }>;
  pullRequests?: PullRequest[];
  _count?: { feedbacks: number; pullReqs: number; members?: number; attachments?: number };
}

/** 需求图片 / 附件 */
export interface Attachment {
  id: string;
  /** IMAGE：需求图片；FILE：可下载附件 */
  kind: 'IMAGE' | 'FILE';
  /** 原始文件名 */
  name: string;
  mime: string;
  /** 文件大小（字节） */
  size: number;
  /** 内联预览地址 */
  url: string;
  /** 下载地址 */
  downloadUrl: string;
  createdAt: string;
}

/** Pull Request 快照 */
export interface PullRequest {
  id: string;
  number: number;
  title: string;
  state: string;
  merged: boolean;
  ciStatus: string;
  hasConflict: boolean;
  htmlUrl: string;
  authorName: string;
  author?: UserBrief | null;
  headBranch?: string | null;
  baseBranch?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 反馈 */
export interface Feedback {
  id: string;
  projectId: string;
  userId: string;
  type: FeedbackType;
  title: string;
  content: string;
  status: FeedbackStatus;
  issueNumber?: number | null;
  issueUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  user?: UserBrief;
  project?: { id: string; title: string; repoUrl?: string | null; ownerId?: string | null };
  comments?: FeedbackComment[];
  _count?: { comments: number };
}

/** 反馈评论 */
export interface FeedbackComment {
  id: string;
  content: string;
  createdAt: string;
  user: UserBrief;
}

/** 站内通知 */
export interface Notification {
  id: string;
  type: string;
  title: string;
  content: string;
  link?: string | null;
  read: boolean;
  createdAt: string;
}

/** 首页统计 */
export interface PlatformStats {
  total: number;
  open: number;
  claimed: number;
  developing: number;
  released: number;
  feedbackOpen: number;
  users: number;
}

/** 我的待办 */
export interface MyTodos {
  owning: Array<{ id: string; title: string; status: ProjectStatus; updatedAt: string }>;
  created: Array<{ id: string; title: string; status: ProjectStatus; updatedAt: string }>;
  pendingFeedbacks: number;
  openPullRequests: number;
}

/** 开发者信息 */
export interface Developer extends UserBrief {
  avatarUrl?: string | null;
}

/** 热力图单日数据 */
export interface HeatmapDay {
  /** 日期（YYYY-MM-DD） */
  date: string;
  /** 当日协作行为数 */
  count: number;
}

/** 贡献概览 */
export interface ContributionSummary {
  projects: number;
  claims: number;
  requesters: number;
  feedbacks: number;
  comments: number;
  pullRequests: number;
}

/** 热力图接口返回 */
export interface HeatmapData {
  from: string;
  to: string;
  total: number;
  max: number;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  days: HeatmapDay[];
  summary: ContributionSummary;
}
