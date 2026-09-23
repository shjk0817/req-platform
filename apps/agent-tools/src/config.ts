/**
 * CLI / MCP 配置
 * 作用：集中读取平台地址、工作区、输出格式与凭据降级策略
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';

export type OutputFormat = 'human' | 'json';

export interface AimConfig {
  apiUrl: string;
  giteaUrl: string;
  giteaOrg: string;
  workspaceRoot: string;
  output: OutputFormat;
  allowFileCredentials: boolean;
  mcpPort: number;
}

export const CONFIG_DIR = join(homedir(), '.config', 'aimanager');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
export const CREDENTIAL_SERVICE = 'aimanager';

const defaults: AimConfig = {
  apiUrl: process.env.AIMANAGER_API_URL ?? 'http://localhost:4000/api',
  giteaUrl: process.env.AIMANAGER_GITEA_URL ?? 'http://git.localhost',
  giteaOrg: process.env.AIMANAGER_GITEA_ORG ?? 'projects',
  workspaceRoot: process.env.AIMANAGER_WORKSPACE ?? join(homedir(), 'aimanager-workspaces'),
  output: process.env.AIM_OUTPUT === 'json' ? 'json' : 'human',
  allowFileCredentials: process.env.AIM_ALLOW_FILE_CREDENTIALS === 'true',
  mcpPort: Number(process.env.AIM_MCP_PORT ?? 4100),
};

/** 读取命令行配置文件与环境变量 */
export function loadConfig(): AimConfig {
  let fileConfig: Partial<AimConfig> = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      fileConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Partial<AimConfig>;
    } catch {
      // 配置文件损坏时使用环境变量与默认值，doctor 会给出修复提示。
    }
  }
  return {
    ...defaults,
    ...fileConfig,
    apiUrl: process.env.AIMANAGER_API_URL ?? fileConfig.apiUrl ?? defaults.apiUrl,
    giteaUrl: process.env.AIMANAGER_GITEA_URL ?? fileConfig.giteaUrl ?? defaults.giteaUrl,
    giteaOrg: process.env.AIMANAGER_GITEA_ORG ?? fileConfig.giteaOrg ?? defaults.giteaOrg,
    workspaceRoot: process.env.AIMANAGER_WORKSPACE ?? fileConfig.workspaceRoot ?? defaults.workspaceRoot,
    output: process.env.AIM_OUTPUT === 'json' ? 'json' : fileConfig.output ?? defaults.output,
  };
}

/** 持久化非敏感配置 */
export function saveConfig(patch: Partial<AimConfig>): AimConfig {
  const next = { ...loadConfig(), ...patch };
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return next;
}
