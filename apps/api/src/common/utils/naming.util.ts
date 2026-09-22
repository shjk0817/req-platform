/**
 * 命名工具函数
 * 作用：把中文/英文字符串转换为合法的 Gitea 仓库名与用户名
 * 说明：内部平台的需求标题基本都是中文，直接按 ASCII 过滤会只剩空串，
 *      因此统一先用拼音转写（zhangwei / sheng-chan-bao-biao），保证仓库名与用户名可读、可搜索
 */
import { pinyin } from 'pinyin-pro';
import { randomBytes } from 'node:crypto';

/**
 * 转写为拼音音节数组
 * 中文按字转拼音，英文等非中文内容按整段保留（便于「报表 Export 工具」这类中英混排标题）
 * @param input 原始文本
 */
function toPinyinSyllables(input: string): string[] {
  return pinyin(input, { toneType: 'none', type: 'array', nonZh: 'consecutive' })
    .map((item) => item.trim().toLowerCase())
    // pinyin-pro 不会把 ü 转为 ASCII，统一写成 v（lv / nv），保持「率/绿/女」可区分
    .map((item) => item.replace(/ü/g, 'v'))
    .map((item) => item.replace(/[^a-z0-9]+/g, ' ').trim())
    .filter((item) => item.length > 0);
}

/**
 * 按音节边界截断，避免出现半个拼音
 * @param value 以「-」分隔的拼音串
 * @param maxLength 最大长度
 */
function truncateAtSyllable(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const cut = value.slice(0, maxLength);
  const boundary = cut.lastIndexOf('-');
  return (boundary > 0 ? cut.slice(0, boundary) : cut).replace(/-+$/, '');
}

/**
 * 生成仓库名 slug：中文转拼音，音节之间用「-」连接
 * @param input 原始文本（通常为需求标题）
 * @param fallback 全部字符被剔除时使用的兜底前缀
 */
export function slugify(input: string, fallback = 'project'): string {
  const joined = toPinyinSyllables(input).join('-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return truncateAtSyllable(joined, 32) || fallback;
}

/**
 * 生成带随机后缀的仓库名，避免重名
 * @param input 原始文本
 */
export function buildRepoName(input: string): string {
  const suffix = randomBytes(3).toString('hex');
  return `req-${slugify(input)}-${suffix}`.slice(0, 60);
}

/**
 * 规范化用户手动填写的 Gitea 仓库名
 * 作用：允许可读英文名，同时在请求 Gitea 前给出明确的中文错误提示
 * @param input 用户填写的仓库名
 * @returns 去除首尾空格后的合法仓库名；空输入返回 undefined
 */
export function normalizeRepoName(input?: string | null): string | undefined {
  const value = input?.trim();
  if (!value) {
    return undefined;
  }
  if (value.length > 100 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) {
    throw new Error('仓库名只能使用字母、数字、连字符、下划线或点号，且必须以字母或数字开头');
  }
  if (value === '.' || value === '..') {
    throw new Error('仓库名不能是 . 或 ..');
  }
  if (/\.git$/i.test(value)) {
    throw new Error('仓库名不能以 .git 结尾');
  }
  return value;
}

/**
 * 由姓名生成合法的 Gitea 用户名
 * Gitea 用户名只允许字母数字、下划线、连字符，且不能以连字符开头或结尾
 * 中文姓名优先转拼音（张伟 -> zhangwei），拿不到时退回邮箱前缀
 * @param email 用户邮箱
 * @param name 用户姓名
 * @param attempt 重试次数：重名时依次追加 2、3，避免又回到随机后缀
 */
export function buildGiteaUsername(email: string, name: string, attempt = 0): string {
  const fromName = toPinyinSyllables(name).join('').replace(/[^a-z0-9_-]/g, '');
  const fromEmail = (email.split('@')[0] ?? '').replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
  const base = (fromName || fromEmail || 'user').slice(0, 26).replace(/^-+|-+$/g, '') || 'user';
  return attempt === 0 ? base : `${base}${attempt + 1}`;
}

/** 生成随机初始密码（用于 Gitea 账号自动开通） */
export function generatePassword(length = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}
