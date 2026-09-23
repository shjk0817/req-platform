#!/usr/bin/env node
/**
 * aim CLI 入口
 * 作用：为员工提供平台协作、Git、PR、CI、Release 与本地 MCP 管理命令
 */
import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createPlatformClient, resolvePlatformToken } from './runtime.js';
import { CredentialStore } from './credentials.js';
import { loadConfig, saveConfig } from './config.js';
import { printError, printResult } from './output.js';
import { createGiteaClient } from './gitea-client.js';
import {
  cloneProject,
  createBranch,
  gitDiff,
  gitStatus,
  readProjectMetadata,
} from './git/safe-git.js';
import { confirmationMessage, consumePendingAction, createPendingAction, executePendingAction } from './confirmation.js';

const program = new Command();
program
  .name('aim')
  .description('aiManager 员工协作与安全 Git 工具')
  .version('0.1.0')
  .option('--json', '输出结构化 JSON');

function format(): 'human' | 'json' {
  return program.opts<{ json?: boolean }>().json ? 'json' : loadConfig().output;
}

async function client() {
  return createPlatformClient();
}

const auth = program.command('auth').description('管理平台与 Gitea 凭据');
auth
  .command('login')
  .description('保存平台个人访问令牌')
  .option('--token <token>', '平台个人访问令牌（建议通过 AIMANAGER_TOKEN 环境变量传入）')
  .action(async (options: { token?: string }) => {
    const token = options.token ?? process.env.AIMANAGER_TOKEN;
    if (!token) {
      throw new Error('请通过 --token 或 AIMANAGER_TOKEN 提供平台令牌');
    }
    await new CredentialStore().set('platform-token', token);
    printResult({ saved: true, service: 'platform' }, format(), '平台令牌已保存到系统钥匙串。');
  });
auth
  .command('gitea')
  .description('保存员工自己的 Gitea PAT')
  .option('--token <token>', '员工 Gitea PAT（建议通过 AIM_GITEA_TOKEN 环境变量传入）')
  .action(async (options: { token?: string }) => {
    const token = options.token ?? process.env.AIM_GITEA_TOKEN;
    if (!token) {
      throw new Error('请通过 --token 或 AIM_GITEA_TOKEN 提供 Gitea PAT');
    }
    await new CredentialStore().set('gitea-token', token);
    printResult({ saved: true, service: 'gitea' }, format(), 'Gitea 令牌已保存到系统钥匙串。');
  });
auth
  .command('logout')
  .description('删除本地平台与 Gitea 凭据')
  .action(async () => {
    const store = new CredentialStore();
    await store.delete('platform-token');
    await store.delete('gitea-token');
    printResult({ deleted: true }, format(), '本地凭据已删除。');
  });

const configCommand = program.command('config').description('查看与修改本地配置');
configCommand
  .command('list')
  .action(() => printResult(loadConfig(), format(), '当前配置：'));
configCommand
  .command('set <key> <value>')
  .action((key: string, value: string) => {
    const mapping: Record<string, keyof ReturnType<typeof loadConfig>> = {
      'api-url': 'apiUrl',
      'gitea-url': 'giteaUrl',
      'gitea-org': 'giteaOrg',
      workspace: 'workspaceRoot',
      output: 'output',
    };
    const configKey = mapping[key];
    if (!configKey) {
      throw new Error(`不支持的配置项：${key}`);
    }
    const nextValue = configKey === 'output' && value === 'json' ? 'json' : value;
    printResult(saveConfig({ [configKey]: nextValue }), format(), '配置已保存。');
  });

const project = program.command('project').description('需求与项目协作');
project
  .command('list')
  .option('--scope <scope>')
  .option('--status <status>')
  .option('--keyword <keyword>')
  .action(async (options: Record<string, string | undefined>) => {
    printResult(await (await client()).listProjects(options), format(), '需求列表：');
  });
project
  .command('context <projectId>')
  .action(async (projectId: string) => {
    printResult(await (await client()).getProjectContext(projectId), format(), '项目上下文：');
  });
project
  .command('create')
  .requiredOption('--title <title>')
  .requiredOption('--description <description>')
  .action(async (options: { title: string; description: string }) => {
    printResult(await (await client()).createProject(options), format(), '需求已发布。');
  });
project
  .command('claim <projectId>')
  .option('--repo-name <repoName>')
  .option('--repo-display-name <repoDisplayName>')
  .option('--remark <remark>')
  .action(async (projectId: string, options: Record<string, string | undefined>) => {
    printResult(await (await client()).claimProject(projectId, {
      repoName: options.repoName,
      repoDisplayName: options.repoDisplayName,
      remark: options.remark,
    }), format(), '需求已认领。');
  });
project
  .command('join <projectId>')
  .action(async (projectId: string) => {
    printResult(await (await client()).joinDevelopment(projectId), format(), '已加入开发协作。');
  });
project
  .command('update <projectId>')
  .requiredOption('--kind <kind>', 'COMMUNICATION 或 ADDITIONAL_REQUIREMENT')
  .requiredOption('--content <content>')
  .action(async (projectId: string, options: { kind: 'COMMUNICATION' | 'ADDITIONAL_REQUIREMENT'; content: string }) => {
    printResult(await (await client()).postUpdate(projectId, options), format(), '项目记录已发布。');
  });

const feedback = program.command('feedback').description('反馈与评论');
feedback
  .command('list')
  .option('--scope <scope>')
  .option('--status <status>')
  .action(async (options: Record<string, string | undefined>) => {
    printResult(await (await client()).listFeedbacks(options), format(), '反馈列表：');
  });
feedback
  .command('create <projectId>')
  .requiredOption('--type <type>')
  .requiredOption('--title <title>')
  .requiredOption('--content <content>')
  .action(async (projectId: string, options: { type: 'BUG' | 'IMPROVEMENT' | 'QUESTION'; title: string; content: string }) => {
    printResult(await (await client()).createFeedback(projectId, options), format(), '反馈已提交。');
  });
feedback
  .command('comment <feedbackId>')
  .requiredOption('--content <content>')
  .action(async (feedbackId: string, options: { content: string }) => {
    printResult(await (await client()).commentFeedback(feedbackId, options.content), format(), '反馈回复已发布。');
  });

const git = program.command('git').description('安全本地 Git 操作');
git
  .command('status')
  .option('--cwd <cwd>')
  .action(async (options: { cwd?: string }) => {
    const config = loadConfig();
    printResult(await gitStatus(resolve(options.cwd ?? process.cwd()), config.workspaceRoot), format(), 'Git 状态：');
  });
git
  .command('diff')
  .option('--cwd <cwd>')
  .option('--staged')
  .action(async (options: { cwd?: string; staged?: boolean }) => {
    const config = loadConfig();
    printResult(await gitDiff(resolve(options.cwd ?? process.cwd()), config.workspaceRoot, options.staged), format(), 'Git diff：');
  });
git
  .command('clone <projectId>')
  .option('--directory <directory>')
  .action(async (projectId: string, options: { directory?: string }) => {
    const config = loadConfig();
    const info = await (await client()).getProjectGit(projectId);
    printResult(await cloneProject(info, config.workspaceRoot, options.directory), format(), '项目已克隆。');
  });
git
  .command('branch <branch>')
  .option('--cwd <cwd>')
  .action(async (branch: string, options: { cwd?: string }) => {
    const config = loadConfig();
    printResult(await createBranch(resolve(options.cwd ?? process.cwd()), config.workspaceRoot, branch), format(), `分支 ${branch} 已创建。`);
  });
git
  .command('commit')
  .requiredOption('-m, --message <message>')
  .option('--cwd <cwd>')
  .action(async (options: { message: string; cwd?: string }) => {
    const config = loadConfig();
    const cwd = resolve(options.cwd ?? process.cwd());
    const action = createPendingAction('commit', { cwd, message: options.message });
    printResult({ actionId: action.id, confirmation: confirmationMessage(action) }, format(), confirmationMessage(action));
  });
git
  .command('push')
  .option('--cwd <cwd>')
  .option('--branch <branch>')
  .action(async (options: { cwd?: string; branch?: string }) => {
    const config = loadConfig();
    const action = createPendingAction('push', { cwd: resolve(options.cwd ?? process.cwd()), branch: options.branch });
    printResult({ actionId: action.id, confirmation: confirmationMessage(action) }, format(), confirmationMessage(action));
  });

const pr = program.command('pr').description('Pull Request');
pr
  .command('list')
  .option('--cwd <cwd>')
  .option('--state <state>')
  .action(async (options: { cwd?: string; state?: 'open' | 'closed' | 'all' }) => {
    const config = loadConfig();
    const metadata = readProjectMetadata(resolve(options.cwd ?? process.cwd()), config.workspaceRoot);
    printResult(await (await createGiteaClient()).listPullRequests(metadata.repoOwner, metadata.repoName, options.state), format(), 'Pull Request：');
  });
pr
  .command('create')
  .requiredOption('--title <title>')
  .option('--body <body>')
  .option('--head <head>')
  .option('--base <base>', '目标分支', 'main')
  .option('--cwd <cwd>')
  .action(async (options: { title: string; body?: string; head?: string; base: string; cwd?: string }) => {
    const config = loadConfig();
    const cwd = resolve(options.cwd ?? process.cwd());
    const metadata = readProjectMetadata(cwd, config.workspaceRoot);
    const action = createPendingAction('pull_request', {
      cwd,
      projectId: metadata.projectId,
      title: options.title,
      body: options.body,
      head: options.head,
      base: options.base,
    });
    printResult({ actionId: action.id, confirmation: confirmationMessage(action) }, format(), confirmationMessage(action));
  });

const ci = program.command('ci').description('持续集成');
ci
  .command('status')
  .option('--cwd <cwd>')
  .action(async (options: { cwd?: string }) => {
    const config = loadConfig();
    const metadata = readProjectMetadata(resolve(options.cwd ?? process.cwd()), config.workspaceRoot);
    printResult(await (await createGiteaClient()).listActions(metadata.repoOwner, metadata.repoName), format(), 'CI 状态：');
  });

const release = program.command('release').description('成果发布');
release
  .command('prepare')
  .requiredOption('--tag <tagName>')
  .requiredOption('--name <name>')
  .option('--body <body>')
  .option('--cwd <cwd>')
  .action(async (options: { tag: string; name: string; body?: string; cwd?: string }) => {
    const config = loadConfig();
    const cwd = resolve(options.cwd ?? process.cwd());
    const metadata = readProjectMetadata(cwd, config.workspaceRoot);
    const action = createPendingAction('release', {
      cwd,
      projectId: metadata.projectId,
      tagName: options.tag,
      name: options.name,
      body: options.body,
    });
    printResult({ actionId: action.id, confirmation: confirmationMessage(action) }, format(), confirmationMessage(action));
  });

program
  .command('approve <actionId>')
  .description('确认并执行一个短时写操作')
  .action(async (actionId: string) => {
    const action = consumePendingAction(actionId);
    const result = await executePendingAction(action);
    printResult(result, format(), `${action.kind} 已执行。`);
  });

program
  .command('doctor')
  .description('检查平台令牌、工作区与 Agent API')
  .action(async () => {
    const config = loadConfig();
    const token = await resolvePlatformToken();
    const workspaces = resolve(config.workspaceRoot);
    const apiClient = await client();
    const [capabilities, data] = await Promise.all([
      apiClient.getCapabilities(),
      apiClient.getMyWork({ pageSize: 1 }),
    ]);
    printResult(
      { apiUrl: config.apiUrl, workspaceRoot: workspaces, token: `${token.slice(0, 12)}…`, capabilities, api: data },
      format(),
      'aim doctor 检查通过。',
    );
  });

const mcp = program.command('mcp').description('本地 MCP companion');
mcp
  .command('serve')
  .description('启动本地 stdio MCP 服务')
  .action(async () => {
    const child = spawn(process.execPath, [resolve(dirname(fileURLToPath(import.meta.url)), 'mcp-stdio.js')], {
      stdio: 'inherit',
    });
    await new Promise<void>((resolvePromise, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => code ? reject(new Error(`aim-mcp 已退出（${code}）`)) : resolvePromise());
    });
  });

void program.parseAsync(process.argv).catch((error: unknown) => {
  printError(error, format());
});
