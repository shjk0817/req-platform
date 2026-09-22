#!/usr/bin/env node
/**
 * 远程 Streamable HTTP MCP 入口
 * 作用：只转发员工自己的 Bearer PAT 到平台 Agent API，不在服务端保存或共享管理员 Gitea Token
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { AgentClient } from './client.js';
import { buildMcpServer } from './mcp/server.js';
import { loadConfig } from './config.js';

const MAX_BODY_BYTES = 2 * 1024 * 1024;

async function main(): Promise<void> {
  const config = loadConfig();
  const server = createServer(async (request, response) => {
    if (request.url?.split('?')[0] !== '/mcp') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ code: 'NOT_FOUND', message: 'MCP endpoint is /mcp' }));
      return;
    }

    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer aim_')) {
      response.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer' });
      response.end(JSON.stringify({ code: 'AUTH_REQUIRED', message: 'MCP 需要员工个人访问令牌' }));
      return;
    }

    try {
      const body = request.method === 'POST' ? await readBody(request) : undefined;
      const token = authorization.slice('Bearer '.length);
      const client = new AgentClient({ apiUrl: config.apiUrl, token });
      const mcpServer = buildMcpServer(client, false);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await mcpServer.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch (error) {
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json' });
      }
      if (!response.writableEnded) {
        response.end(JSON.stringify({ code: 'MCP_REQUEST_FAILED', message: error instanceof Error ? error.message : String(error) }));
      }
    }
  });

  server.listen(config.mcpPort, '0.0.0.0', () => {
    process.stderr.write(`aimanager remote MCP listening on http://0.0.0.0:${config.mcpPort}/mcp\n`);
  });
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error('MCP 请求体过大');
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}

void main().catch((error: unknown) => {
  process.stderr.write(`aim-mcp-server 启动失败：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
