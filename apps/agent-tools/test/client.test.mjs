/**
 * Agent API 客户端协议测试
 * 作用：验证 Bearer 令牌、request id 与稳定错误码不会在客户端层丢失
 */
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentApiError, AgentClient } from '../dist/client.js';

/** 启动一个只返回固定协议响应的临时 HTTP 服务 */
async function startStubApi() {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request);
    if (request.url === '/api/agent/capabilities') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ version: 'v1', tools: ['get_my_work'] }));
      return;
    }
    response.writeHead(401, { 'content-type': 'application/json', 'x-request-id': 'server-request-id' });
    response.end(JSON.stringify({
      code: 'TOKEN_REVOKED',
      message: '个人访问令牌已撤销',
      requestId: 'server-request-id',
    }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.equal(typeof address, 'object');
  return {
    server,
    requests,
    url: `http://127.0.0.1:${address.port}/api`,
  };
}

test('客户端向 Agent API 发送 Bearer PAT 与 request id', async () => {
  const stub = await startStubApi();
  try {
    const client = new AgentClient({ apiUrl: stub.url, token: 'aim_test-token' });
    await assert.doesNotReject(client.getCapabilities());
    assert.equal(stub.requests[0].headers.authorization, 'Bearer aim_test-token');
    assert.match(stub.requests[0].headers['x-request-id'], /^[0-9a-f-]{36}$/);
  } finally {
    stub.server.close();
  }
});

test('客户端保留服务端稳定错误码与 request id', async () => {
  const stub = await startStubApi();
  try {
    const client = new AgentClient({ apiUrl: stub.url, token: 'aim_test-token' });
    await assert.rejects(
      client.listProjects(),
      (error) => {
        assert.ok(error instanceof AgentApiError);
        assert.equal(error.code, 'TOKEN_REVOKED');
        assert.equal(error.requestId, 'server-request-id');
        assert.equal(error.status, 401);
        return true;
      },
    );
  } finally {
    stub.server.close();
  }
});
