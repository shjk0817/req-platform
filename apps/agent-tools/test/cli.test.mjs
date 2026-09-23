/**
 * aim CLI 命令协议测试
 * 作用：锁定帮助菜单与 JSON 配置输出，避免发布包出现入口回归
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

/** 在隔离 HOME 下运行一次 CLI 并收集标准输出 */
function runCli(args, home) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(process.cwd(), 'dist/cli.js'), ...args], {
      env: {
        ...process.env,
        HOME: home,
        AIMANAGER_API_URL: 'http://example.test/api',
        AIMANAGER_WORKSPACE: join(home, 'workspaces'),
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('aim help 展示平台、Git 与 MCP 命令树', async () => {
  const home = await mkdtemp(join(tmpdir(), 'aim-cli-'));
  try {
    const result = await runCli(['--help'], home);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /project/);
    assert.match(result.stdout, /git/);
    assert.match(result.stdout, /mcp/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('aim --json config list 输出可解析的结构化结果', async () => {
  const home = await mkdtemp(join(tmpdir(), 'aim-cli-'));
  try {
    const result = await runCli(['--json', 'config', 'list'], home);
    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.apiUrl, 'http://example.test/api');
    assert.equal(payload.data.workspaceRoot, join(home, 'workspaces'));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
