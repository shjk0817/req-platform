/**
 * Agent API 共享类型
 * 作用：让 CLI、远程 MCP 和本地 MCP 对平台响应使用同一份结构化契约
 */
export type IntegrationScope = 'read' | 'project:write' | 'feedback:write' | 'git:metadata';

export interface AgentError {
  statusCode?: number;
  code?: string;
  requestId?: string;
  message?: string;
}

export interface ProjectGitInfo {
  projectId: string;
  repoOwner: string | null;
  repoName: string | null;
  repoDisplayName: string | null;
  repoUrl: string | null;
  defaultBranch: string;
  httpCloneUrl: string | null;
  sshCloneUrl: string | null;
  giteaUsername: string | null;
  permission: 'read' | 'write';
  canWrite: boolean;
}

export interface ProjectContext {
  project: Record<string, unknown>;
  updates: unknown[];
  feedbacks: unknown;
}

export interface AgentClientOptions {
  apiUrl: string;
  token: string;
}

export interface CreateProjectInput {
  title: string;
  description: string;
  imageIds?: string[];
  attachmentIds?: string[];
}

export interface CreateUpdateInput {
  kind: 'COMMUNICATION' | 'ADDITIONAL_REQUIREMENT';
  content: string;
}

export interface CreateFeedbackInput {
  type: 'BUG' | 'IMPROVEMENT' | 'QUESTION';
  title: string;
  content: string;
}
