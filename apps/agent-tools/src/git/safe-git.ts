/**
 * 安全 Git 执行层
 * 作用：所有 Git 操作使用 execFile 参数数组，限制工作区、远程主机、分支与危险 refspec
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { ProjectGitInfo } from '../types.js';

const execFileAsync = promisify(execFile);
const DANGEROUS_ARGS = new Set(['--force', '-f', '--mirror', '--all', '--delete']);
const SECRET_FILE = /(^|\/)(\.env(?:\..*)?|id_rsa|id_ed25519|.*\.(pem|key|p12|pfx))$/i;

export class GitSafetyError extends Error {
  readonly code = 'GIT_SAFETY_REJECTED';
}

export interface GitCommandResult {
  stdout: string;
  stderr: string;
}

export interface LocalProjectMetadata {
  projectId: string;
  repoOwner: string;
  repoName: string;
  giteaUrl: string;
  createdAt: string;
}

/** 执行受限 Git 命令 */
export async function runGit(cwd: string, args: string[], workspaceRoot: string): Promise<GitCommandResult> {
  assertWorkspace(cwd, workspaceRoot);
  for (const arg of args) {
    if (DANGEROUS_ARGS.has(arg) || arg.includes('://') && /:\/\/[^/]*:[^@]+@/.test(arg)) {
      throw new GitSafetyError(`已拒绝危险 Git 参数：${arg}`);
    }
  }
  try {
    return await execFileAsync('git', args, {
      cwd,
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    const detail = error as { message?: string; stderr?: string };
    throw new Error(`Git 命令失败：${detail.stderr || detail.message || '未知错误'}`);
  }
}

/** 查询工作区状态 */
export function gitStatus(cwd: string, workspaceRoot: string) {
  return runGit(cwd, ['status', '--short', '--branch'], workspaceRoot);
}

/** 查询未提交 diff */
export async function gitDiff(cwd: string, workspaceRoot: string, staged = false) {
  return runGit(cwd, ['diff', ...(staged ? ['--cached'] : []), '--stat', '--', '.'], workspaceRoot);
}

/** 只允许约定的功能分支 */
export function assertSafeBranch(branch: string): void {
  if (!/^(feature|fix|chore)\/[a-z0-9][a-z0-9._/-]{1,80}$/i.test(branch)) {
    throw new GitSafetyError('分支名必须以 feature/、fix/ 或 chore/ 开头，且只包含安全字符');
  }
  if (branch.includes('..') || branch.endsWith('/') || branch.includes('@{')) {
    throw new GitSafetyError('分支名包含危险 ref 表达式');
  }
}

/** 创建安全功能分支 */
export async function createBranch(cwd: string, workspaceRoot: string, branch: string): Promise<GitCommandResult> {
  assertSafeBranch(branch);
  return runGit(cwd, ['switch', '-c', branch], workspaceRoot);
}

/** 提交当前变更，调用方应在此函数前完成人工/Agent 确认 */
export async function commitChanges(
  cwd: string,
  workspaceRoot: string,
  message: string,
): Promise<GitCommandResult> {
  if (!message.trim() || message.length > 200) {
    throw new GitSafetyError('提交说明不能为空且不能超过 200 个字符');
  }
  const changed = await runGit(cwd, ['status', '--short'], workspaceRoot);
  const files = changed.stdout
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
  const secret = files.find((file) => SECRET_FILE.test(file));
  if (secret) {
    throw new GitSafetyError(`检测到敏感文件 ${secret}，拒绝自动提交`);
  }
  await runGit(cwd, ['add', '--all', '--', '.'], workspaceRoot);
  return runGit(cwd, ['commit', '-m', message], workspaceRoot);
}

/** 推送当前分支，禁止主分支和 force push */
export async function pushBranch(
  cwd: string,
  workspaceRoot: string,
  branch?: string,
  remote = 'origin',
): Promise<GitCommandResult> {
  const current = branch ?? (await runGit(cwd, ['branch', '--show-current'], workspaceRoot)).stdout.trim();
  assertPushBranch(current);
  const remoteUrl = (await runGit(cwd, ['remote', 'get-url', remote], workspaceRoot)).stdout.trim();
  assertRemoteUrl(remoteUrl);
  return runGit(cwd, ['push', remote, current], workspaceRoot);
}

/** 克隆项目并写入平台项目元数据 */
export async function cloneProject(
  info: ProjectGitInfo,
  workspaceRoot: string,
  targetDirectory?: string,
): Promise<{ directory: string; metadata: LocalProjectMetadata; result: GitCommandResult }> {
  if (!info.sshCloneUrl && !info.httpCloneUrl) {
    throw new GitSafetyError('项目尚未配置可用的 Git 仓库');
  }
  const directory = resolve(targetDirectory ?? join(workspaceRoot, safeDirectoryName(info.repoDisplayName ?? info.repoName ?? info.projectId)));
  assertNewWorkspacePath(directory, workspaceRoot);
  mkdirSync(dirname(directory), { recursive: true });
  const cloneUrl = info.sshCloneUrl ?? info.httpCloneUrl;
  if (!cloneUrl) {
    throw new GitSafetyError('项目没有可用的 clone 地址');
  }
  assertRemoteUrl(cloneUrl);
  const result = await execFileAsync('git', ['clone', '--', cloneUrl, directory], {
    cwd: workspaceRoot,
    timeout: 300_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  const metadata: LocalProjectMetadata = {
    projectId: info.projectId,
    repoOwner: info.repoOwner ?? '',
    repoName: info.repoName ?? '',
    giteaUrl: info.repoUrl ?? '',
    createdAt: new Date().toISOString(),
  };
  const metadataDir = join(directory, '.aimanager');
  mkdirSync(metadataDir, { recursive: true });
  writeFileSync(join(metadataDir, 'project.json'), `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
  return { directory, metadata, result };
}

/** 读取本地项目元数据 */
export function readProjectMetadata(cwd: string, workspaceRoot: string): LocalProjectMetadata {
  assertWorkspace(cwd, workspaceRoot);
  const root = realpathSync(cwd);
  const path = join(root, '.aimanager', 'project.json');
  if (!existsSync(path)) {
    throw new GitSafetyError('当前目录不是 aim clone 创建的项目工作区');
  }
  return JSON.parse(readFileSync(path, 'utf8')) as LocalProjectMetadata;
}

function assertPushBranch(branch: string): void {
  if (!branch || branch === 'main' || branch === 'master' || branch === 'develop') {
    throw new GitSafetyError('禁止直接推送主分支，请先创建 feature/、fix/ 或 chore/ 分支');
  }
  assertSafeBranch(branch);
}

function assertRemoteUrl(remote: string): void {
  if (!remote || remote.startsWith('-') || /:\/\/[^/]*:[^@]+@/.test(remote)) {
    throw new GitSafetyError('Git 远程地址为空、包含选项或内嵌凭据');
  }
  if (!/^git@[^:]+:[^/]+\/[^/]+(?:\.git)?$/.test(remote) && !/^ssh:\/\/git@[^/]+(?::\d+)?\/[^/]+\/[^/]+(?:\.git)?$/.test(remote) && !/^https?:\/\/[^/]+\/[^/]+\/[^/]+(?:\.git)?$/.test(remote)) {
    throw new GitSafetyError('Git 远程地址格式不受支持');
  }
}

function assertWorkspace(cwd: string, workspaceRoot: string): void {
  if (!isAbsolute(cwd) || !existsSync(cwd)) {
    throw new GitSafetyError('Git 工作目录不存在');
  }
  const root = realpathSync(resolve(workspaceRoot));
  const target = realpathSync(cwd);
  const rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new GitSafetyError('Git 操作只能在配置的工作区目录内执行');
  }
}

function assertNewWorkspacePath(directory: string, workspaceRoot: string): void {
  const root = resolve(workspaceRoot);
  const rel = relative(root, directory);
  if (rel.startsWith('..') || isAbsolute(rel) || basename(directory) === '') {
    throw new GitSafetyError('目标目录必须位于配置的工作区目录内');
  }
  if (existsSync(directory)) {
    throw new GitSafetyError('目标目录已存在，为避免覆盖文件而拒绝 clone');
  }
}

function safeDirectoryName(value: string): string {
  const result = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return result || 'project';
}
