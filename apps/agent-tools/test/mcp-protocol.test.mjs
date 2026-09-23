/**
 * Streamable HTTP MCP 协议测试
 * 作用：使用真实 MCP SDK 启动服务并验证 initialize 握手与工具能力声明
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';

/** 从普通 JSON 或 SSE data 帧中解析 MCP 响应 */
function parseMcpResponse(text) {
  const candidate = text.includes('data:')
    ? text.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim()
    : text;
  return JSON.parse(candidate);
}

/** 启动远程 MCP 进程并等待端口可用 */
async function startMcp() {
  const port = 43000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['dist/mcp-http.js'], {
    env: {
      ...process.env,
      AIM_MCP_PORT: String(port),
      AIMANAGER_API_URL: 'http://127.0.0.1:9/api',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await fetch(`http://127.0.0.1:${port}/mcp`, { signal: AbortSignal.timeout(100) });
      return { child, port, stderr };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  child.kill();
  throw new Error(`MCP 服务未启动：${stderr}`);
}

test('远程 MCP 完成 initialize 握手并声明平台工具', async () => {
  const mcp = await startMcp();
  try {
    const response = await fetch(`http://127.0.0.1:${mcp.port}/mcp`, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer aim_protocol-test',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'protocol-test', version: '0.1.0' },
        },
      }),
    });
    const body = parseMcpResponse(await response.text());
    assert.equal(response.status, 200);
    assert.equal(body.result.serverInfo.name, 'aimanager-remote-mcp');
    assert.equal(body.result.capabilities.tools.listChanged, true);
  } finally {
    mcp.child.kill();
    await once(mcp.child, 'close');
  }
});
