#!/usr/bin/env node
/**
 * 本地 stdio MCP companion 入口
 * 作用：供 Cursor、Claude 等桌面客户端调用平台工具与安全本地 Git 工具
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createPlatformClient } from './runtime.js';
import { buildMcpServer } from './mcp/server.js';

async function main(): Promise<void> {
  const client = await createPlatformClient();
  const server = buildMcpServer(client, true);
  await server.connect(new StdioServerTransport());
}

void main().catch((error: unknown) => {
  process.stderr.write(`aim-mcp 启动失败：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
