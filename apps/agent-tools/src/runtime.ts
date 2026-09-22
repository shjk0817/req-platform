/**
 * Agent 工具运行时
 * 作用：统一从环境变量或系统钥匙串读取平台令牌，并构造 API 客户端
 */
import { AgentClient } from './client.js';
import { loadConfig } from './config.js';
import { CredentialStore } from './credentials.js';

export async function resolvePlatformToken(explicitToken?: string): Promise<string> {
  const token = explicitToken ?? process.env.AIMANAGER_TOKEN ?? (await new CredentialStore().get('platform-token'));
  if (!token) {
    throw new Error('未找到平台个人访问令牌，请先执行 aim auth login');
  }
  return token;
}

export async function createPlatformClient(explicitToken?: string): Promise<AgentClient> {
  const config = loadConfig();
  return new AgentClient({
    apiUrl: config.apiUrl,
    token: await resolvePlatformToken(explicitToken),
  });
}
