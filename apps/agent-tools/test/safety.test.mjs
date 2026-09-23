/**
 * CLI 安全边界测试
 * 作用：验证危险分支、工作区越界和敏感文件提交会被拒绝
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertSafeBranch, commitChanges, runGit } from '../dist/git/safe-git.js';
import { confirmationMessage, consumePendingAction, createPendingAction, requestApproval } from '../dist/confirmation.js';

const execFileAsync = promisify(execFile);

test('只允许安全功能分支', () => {
  assert.doesNotThrow(() => assertSafeBranch('feature/add-export'));
  assert.throws(() => assertSafeBranch('main'), /分支名必须/);
  assert.throws(() => assertSafeBranch('feature/foo..bar'), /危险/);
});

test('Git 工作目录不能越出配置工作区', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'aimanager-workspace-'));
  const outside = await mkdtemp(join(tmpdir(), 'aimanager-outside-'));
  await assert.rejects(() => runGit(outside, ['status'], workspace), /工作区目录内/);
});

test('提交前拒绝敏感文件', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'aimanager-workspace-'));
  const repo = join(workspace, 'repo');
  await mkdir(repo);
  await execFileAsync('git', ['init', '-q', '-b', 'feature/test'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  await writeFile(join(repo, '.env'), 'SECRET=do-not-commit\n');
  await assert.rejects(() => commitChanges(repo, workspace, 'test: secret'), /敏感文件/);
});

test('MCP 原生确认通过后消费一次性 action', async () => {
  const approval = await requestApproval(
    {
      mcpReq: {
        elicitInput: async () => ({ action: 'accept', content: { confirm: true } }),
      },
    },
    'push',
    { cwd: process.cwd() },
  );
  assert.equal(approval.approved, true);
  assert.match(confirmationMessage(approval.action), /aim approve/);
  assert.throws(() => consumePendingAction(approval.action.id), /不存在|已执行/);
});
