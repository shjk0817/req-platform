/**
 * CLI / MCP 结构化输出
 * 作用：同一结果同时适合人阅读和 AI 继续解析，禁止把敏感凭据写入输出
 */
import type { OutputFormat } from './config.js';

export interface ToolResult<T = unknown> {
  [key: string]: unknown;
  ok: boolean;
  data?: T;
  message: string;
  code?: string;
}

/** 生成 MCP 工具返回体 */
export function mcpResult<T>(data: T, message: string): {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: ToolResult<T>;
} {
  const structuredContent: ToolResult<T> = { ok: true, data, message };
  return {
    content: [{ type: 'text', text: message }],
    structuredContent,
  };
}

/** 生成 MCP 错误返回体 */
export function mcpError(error: unknown): {
  isError: true;
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: ToolResult;
} {
  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'TOOL_FAILED';
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
    structuredContent: { ok: false, message, code },
  };
}

/** CLI 输出 */
export function printResult<T>(data: T, format: OutputFormat, message = '操作完成'): void {
  if (format === 'json') {
    process.stdout.write(`${JSON.stringify({ ok: true, data, message }, null, 2)}\n`);
    return;
  }
  if (typeof data === 'string') {
    process.stdout.write(`${data}\n`);
    return;
  }
  process.stdout.write(`${message}\n${JSON.stringify(data, null, 2)}\n`);
}

/** CLI 错误输出并设置非零退出码 */
export function printError(error: unknown, format: OutputFormat): void {
  const message = error instanceof Error ? error.message : String(error);
  if (format === 'json') {
    process.stdout.write(`${JSON.stringify({ ok: false, message }, null, 2)}\n`);
  } else {
    process.stderr.write(`错误：${message}\n`);
  }
  process.exitCode = 1;
}
