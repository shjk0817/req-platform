/**
 * 写操作确认队列
 * 作用：为 MCP 客户端和 CLI 提供统一短时 action id，确认前不执行 commit、push、PR、release
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR } from './config.js';
import { createGiteaClient } from './gitea-client.js';
import {
  commitChanges,
  gitStatus,
  pushBranch,
  readProjectMetadata,
} from './git/safe-git.js';

const ACTION_DIR = join(CONFIG_DIR, 'actions');
const TTL_MS = 10 * 60 * 1000;

export type PendingActionKind = 'commit' | 'push' | 'pull_request' | 'release';

export interface PendingAction {
  id: string;
  kind: PendingActionKind;
  payload: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
}

/** 创建待确认操作，不执行任何副作用 */
export function createPendingAction(kind: PendingActionKind, payload: Record<string, unknown>): PendingAction {
  mkdirSync(ACTION_DIR, { recursive: true, mode: 0o700 });
  const now = Date.now();
  const action: PendingAction = {
    id: randomBytes(6).toString('hex'),
    kind,
    payload,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL_MS).toISOString(),
  };
  writeFileSync(join(ACTION_DIR, `${action.id}.json`), `${JSON.stringify(action, null, 2)}\n`, { mode: 0o600 });
  return action;
}

/** 消费已确认的待执行操作 */
export function consumePendingAction(id: string): PendingAction {
  if (!/^[a-f0-9]{12}$/.test(id)) {
    throw new Error('action id 格式不正确');
  }
  const path = join(ACTION_DIR, `${id}.json`);
  if (!existsSync(path)) {
    throw new Error('action id 不存在、已执行或已过期');
  }
  const action = JSON.parse(readFileSync(path, 'utf8')) as PendingAction;
  unlinkSync(path);
  if (new Date(action.expiresAt).getTime() <= Date.now()) {
    throw new Error('action id 已过期，请重新发起操作');
  }
  return action;
}

/** 取消尚未执行的待确认操作 */
export function cancelPendingAction(id: string): void {
  const path = join(ACTION_DIR, `${id}.json`);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

/**
 * 优先使用 MCP 原生 elicitation；客户端不支持时回退为 aim approve
 * @param extra MCP 工具上下文
 */
export async function requestApproval(
  extra: unknown,
  kind: PendingActionKind,
  payload: Record<string, unknown>,
): Promise<{ approved: boolean; action?: PendingAction }> {
  const action = createPendingAction(kind, payload);
  const elicit = (extra as { mcpReq?: { elicitInput?: (input: unknown) => Promise<{ action: string }> } } | undefined)
    ?.mcpReq?.elicitInput;
  if (typeof elicit !== 'function') {
    return { approved: false, action };
  }
  try {
    const result = await elicit({
      mode: 'form',
      message: confirmationMessage(action),
      requestedSchema: {
        type: 'object',
        properties: { confirm: { type: 'boolean', title: '确认执行此写操作', default: false } },
        required: ['confirm'],
      },
    });
    if (result.action === 'accept') {
      const consumed = consumePendingAction(action.id);
      return { approved: true, action: consumed };
    }
  } catch {
    // 客户端声明了能力但请求失败时，保留 action id 走显式 CLI 确认。
    return { approved: false, action };
  }
  cancelPendingAction(action.id);
  return { approved: false };
}

/** 执行已经通过原生 elicitation 或 aim approve 的操作 */
export async function executePendingAction(action: PendingAction): Promise<unknown> {
  const config = (await import('./config.js')).loadConfig();
  if (action.kind === 'commit') {
    return commitChanges(String(action.payload.cwd), config.workspaceRoot, String(action.payload.message));
  }
  if (action.kind === 'push') {
    return pushBranch(
      String(action.payload.cwd),
      config.workspaceRoot,
      action.payload.branch ? String(action.payload.branch) : undefined,
    );
  }
  const metadata = readProjectMetadata(String(action.payload.cwd), config.workspaceRoot);
  const gitea = await createGiteaClient();
  if (action.kind === 'pull_request') {
    const status = await gitStatus(String(action.payload.cwd), config.workspaceRoot);
    const currentBranch = status.stdout.split('\n')[0]?.replace('## ', '').split('...')[0];
    const head = action.payload.head ? String(action.payload.head) : currentBranch;
    if (!head) {
      throw new Error('无法确定当前分支');
    }
    return gitea.createPullRequest(metadata.repoOwner, metadata.repoName, {
      title: String(action.payload.title),
      body: action.payload.body ? String(action.payload.body) : undefined,
      head,
      base: action.payload.base ? String(action.payload.base) : 'main',
    });
  }
  return gitea.createRelease(metadata.repoOwner, metadata.repoName, {
    tag_name: String(action.payload.tagName),
    name: String(action.payload.name),
    body: action.payload.body ? String(action.payload.body) : undefined,
    draft: true,
  });
}

/** 供 MCP 展示给用户的确认文案 */
export function confirmationMessage(action: PendingAction): string {
  const labels: Record<PendingActionKind, string> = {
    commit: '提交本地代码',
    push: '推送代码到 Gitea',
    pull_request: '创建 Pull Request',
    release: '准备 Gitea Release',
  };
  return `即将${labels[action.kind]}。请确认无误后执行：aim approve ${action.id}（10 分钟内有效）`;
}
