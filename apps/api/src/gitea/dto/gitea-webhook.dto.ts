/**
 * Gitea Webhook 事件载荷类型定义
 * 说明：这里只声明平台会用到的字段，其余字段允许存在但忽略
 */

/** Webhook 通用字段 */
export interface GiteaWebhookBase {
  /** 事件触发时间 */
  action?: string;
  /** 仓库信息 */
  repository?: {
    id: number;
    name: string;
    full_name: string;
    html_url: string;
    owner: { login: string };
  };
  /** 触发人 */
  sender?: { id: number; login: string; full_name?: string };
}

/** pull_request 事件 */
export interface GiteaPullRequestEvent extends GiteaWebhookBase {
  action?: 'opened' | 'closed' | 'reopened' | 'edited' | 'synchronize' | 'review_requested';
  number?: number;
  pull_request?: {
    number: number;
    title: string;
    body?: string;
    state: 'open' | 'closed';
    merged: boolean;
    mergeable?: boolean;
    html_url: string;
    user: { login: string };
    head: { ref: string };
    base: { ref: string };
    merged_at?: string | null;
    closed_at?: string | null;
    created_at?: string;
  };
}

/** pull_request_review 事件 */
export interface GiteaPullRequestReviewEvent extends GiteaWebhookBase {
  action?: string;
  pull_request?: {
    number: number;
    title: string;
    html_url: string;
    user: { login: string };
    head: { ref: string };
  };
  review?: { state: string; body?: string };
}

/** issues 事件 */
export interface GiteaIssueEvent extends GiteaWebhookBase {
  action?: string;
  issue?: {
    number: number;
    title: string;
    state: 'open' | 'closed';
    html_url: string;
  };
}

/** issue_comment 事件 */
export interface GiteaIssueCommentEvent extends GiteaWebhookBase {
  action?: string;
  issue?: { number: number; title: string; html_url: string };
  comment?: { id: number; body: string; html_url: string; user: { login: string } };
}

/** status 事件（提交状态，CI 场景） */
export interface GiteaStatusEvent extends GiteaWebhookBase {
  state?: 'pending' | 'success' | 'failure' | 'error';
  context?: string;
  target_url?: string;
  sha?: string;
  branches?: Array<{ name: string }>;
}

/** workflow_run 事件（Actions 流水线运行） */
export interface GiteaWorkflowRunEvent extends GiteaWebhookBase {
  action?: string;
  workflow_run?: {
    id: number;
    name?: string;
    status?: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested';
    conclusion?: 'success' | 'failure' | 'cancelled' | 'skipped' | 'neutral' | null;
    head_branch?: string;
    head_sha?: string;
    html_url?: string;
    run_number?: number;
  };
}

/** release 事件 */
export interface GiteaReleaseEvent extends GiteaWebhookBase {
  action?: string;
  release?: { tag_name: string; name: string; html_url: string; prerelease: boolean };
}

/** push 事件 */
export interface GiteaPushEvent extends GiteaWebhookBase {
  /** 分支引用，形如 refs/heads/feat/xxx */
  ref?: string;
  before?: string;
  after?: string;
  commits?: Array<{ id: string; message: string; author?: { name?: string } }>;
}

/** 工作流上报的流水线结果（平台自定义回调协议） */
export interface CiCallbackPayload {
  /** 仓库全名 org/repo */
  repo: string;
  /** 分支名 */
  branch?: string;
  /** 流水线状态 */
  status: 'pending' | 'success' | 'failure';
  /** 工作流名称 */
  workflow?: string;
  /** 流水线运行地址 */
  runUrl?: string;
  /** 提交哈希 */
  sha?: string;
}
