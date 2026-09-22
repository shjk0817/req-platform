/**
 * 机器客户端权限范围
 * 作用：统一约束 CLI、MCP 与 Agent API 能执行的操作
 */
export const INTEGRATION_SCOPES = [
  'read',
  'project:write',
  'feedback:write',
  'git:metadata',
] as const;

export type IntegrationScope = (typeof INTEGRATION_SCOPES)[number];
