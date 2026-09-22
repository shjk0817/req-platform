/**
 * MCP Server 工厂
 * 作用：远程 MCP 与本地 stdio MCP 共享平台工具，仅按运行模式增加本地 Git 能力
 */
import { AgentClient } from '../client.js';
import { registerLocalTools } from './local-tools.js';
import { registerPlatformTools } from './platform-tools.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function buildMcpServer(client: AgentClient, local = false): McpServer {
  const server = new McpServer({
    name: local ? 'aimanager-local-mcp' : 'aimanager-remote-mcp',
    version: '0.1.0',
  });
  registerPlatformTools(server, client);
  if (local) {
    registerLocalTools(server, client);
  }
  return server;
}
