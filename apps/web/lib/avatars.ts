/**
 * 预设头像
 * 作用：与后端 common/constants/avatars.ts 保持一致，
 *      同事头像使用内置的「人物插画」（不用外部图床，内网可用），
 *      任务头像继续使用 emoji + 渐变底色。
 */

/** 人物插画参数：用一组配色 + 发型描述一个人，由 PersonAvatar 渲染成 SVG */
export interface PersonSpec {
  /** 肤色 */
  skin: string;
  /** 头发（含刘海）颜色 */
  hair: string;
  /** 上衣颜色 */
  shirt: string;
  /** 发型，决定头发与轮廓形状 */
  hairstyle: 'short' | 'side' | 'buzz' | 'bob' | 'long' | 'bun' | 'ponytail' | 'curly';
}

/** 单个预设头像 */
export interface AvatarPreset {
  /** 头像标识，与后端校验列表一致 */
  key: string;
  /** 底色渐变（人物插画的背景） */
  background: string;
  /** 展示用的图形：任务头像使用 emoji */
  emoji?: string;
  /** 人物插画参数（同事头像使用） */
  person?: PersonSpec;
}

/** 同事可选头像：统一为人物插画，避免「动物头像」的观感 */
export const USER_AVATARS: AvatarPreset[] = [
  { key: 'user-01', background: 'linear-gradient(135deg, #dbeafe, #93c5fd)', person: { skin: '#f2c9a8', hair: '#2f2a26', shirt: '#1677ff', hairstyle: 'short' } },
  { key: 'user-02', background: 'linear-gradient(135deg, #fde7d3, #fdba74)', person: { skin: '#f6d5b8', hair: '#4a3728', shirt: '#fa8c16', hairstyle: 'bob' } },
  { key: 'user-03', background: 'linear-gradient(135deg, #e4e7ed, #b0b6c3)', person: { skin: '#eec19d', hair: '#1f1b18', shirt: '#595959', hairstyle: 'buzz' } },
  { key: 'user-04', background: 'linear-gradient(135deg, #ffe0e6, #fb7185)', person: { skin: '#f7d0b0', hair: '#5b3a29', shirt: '#f43f5e', hairstyle: 'long' } },
  { key: 'user-05', background: 'linear-gradient(135deg, #e9d5ff, #c084fc)', person: { skin: '#e8b48c', hair: '#2b2320', shirt: '#722ed1', hairstyle: 'curly' } },
  { key: 'user-06', background: 'linear-gradient(135deg, #d1fae5, #34d399)', person: { skin: '#f4cba6', hair: '#6b4423', shirt: '#13c2c2', hairstyle: 'ponytail' } },
  { key: 'user-07', background: 'linear-gradient(135deg, #fef3c7, #fbbf24)', person: { skin: '#d9a273', hair: '#1a1512', shirt: '#f59e0b', hairstyle: 'side' } },
  { key: 'user-08', background: 'linear-gradient(135deg, #cffafe, #22d3ee)', person: { skin: '#f3c9a5', hair: '#3f2f24', shirt: '#08979c', hairstyle: 'bun' } },
  { key: 'user-09', background: 'linear-gradient(135deg, #ede9fe, #a78bfa)', person: { skin: '#c88a5a', hair: '#161210', shirt: '#6366f1', hairstyle: 'buzz' } },
  { key: 'user-10', background: 'linear-gradient(135deg, #ffe4e6, #fda4af)', person: { skin: '#f7d6bb', hair: '#7a4a26', shirt: '#eb2f96', hairstyle: 'bob' } },
  { key: 'user-11', background: 'linear-gradient(135deg, #e0f2fe, #38bdf8)', person: { skin: '#eabf96', hair: '#241d18', shirt: '#0284c7', hairstyle: 'short' } },
  { key: 'user-12', background: 'linear-gradient(135deg, #ecfccb, #a3e635)', person: { skin: '#a9673a', hair: '#0f0c0a', shirt: '#65a30d', hairstyle: 'curly' } },
  { key: 'user-13', background: 'linear-gradient(135deg, #ffedd5, #fb923c)', person: { skin: '#f5cfa8', hair: '#4b3621', shirt: '#ea580c', hairstyle: 'long' } },
  { key: 'user-14', background: 'linear-gradient(135deg, #f3e8ff, #d8b4fe)', person: { skin: '#e5b183', hair: '#33261c', shirt: '#9333ea', hairstyle: 'side' } },
  { key: 'user-15', background: 'linear-gradient(135deg, #ccfbf1, #5eead4)', person: { skin: '#f8d8bb', hair: '#8a5a2b', shirt: '#0d9488', hairstyle: 'ponytail' } },
  { key: 'user-16', background: 'linear-gradient(135deg, #dbeafe, #a5b4fc)', person: { skin: '#c98d5f', hair: '#1c1613', shirt: '#4f46e5', hairstyle: 'bun' } },
  { key: 'user-17', background: 'linear-gradient(135deg, #e2e8f0, #94a3b8)', person: { skin: '#f1c6a4', hair: '#514035', shirt: '#475569', hairstyle: 'short' } },
  { key: 'user-18', background: 'linear-gradient(135deg, #ffd9c9, #fca07a)', person: { skin: '#eab992', hair: '#2a211c', shirt: '#c2410c', hairstyle: 'bob' } },
];

/** 任务（需求）可选头像：继续用 emoji，语义清晰且与需求主题对应 */
export const TASK_AVATARS: AvatarPreset[] = [
  { key: 'task-01', emoji: '📊', background: 'linear-gradient(135deg, #dbeafe, #3b82f6)' },
  { key: 'task-02', emoji: '🛠️', background: 'linear-gradient(135deg, #e2e8f0, #64748b)' },
  { key: 'task-03', emoji: '📈', background: 'linear-gradient(135deg, #d1fae5, #10b981)' },
  { key: 'task-04', emoji: '🤖', background: 'linear-gradient(135deg, #ede9fe, #8b5cf6)' },
  { key: 'task-05', emoji: '🔍', background: 'linear-gradient(135deg, #fef9c3, #eab308)' },
  { key: 'task-06', emoji: '📱', background: 'linear-gradient(135deg, #ccfbf1, #14b8a6)' },
  { key: 'task-07', emoji: '🧪', background: 'linear-gradient(135deg, #fae8ff, #d946ef)' },
  { key: 'task-08', emoji: '📮', background: 'linear-gradient(135deg, #ffe4e6, #f43f5e)' },
  { key: 'task-09', emoji: '🗂️', background: 'linear-gradient(135deg, #ffedd5, #f97316)' },
  { key: 'task-10', emoji: '🎨', background: 'linear-gradient(135deg, #fce7f3, #ec4899)' },
  { key: 'task-11', emoji: '⚙️', background: 'linear-gradient(135deg, #e0e7ff, #6366f1)' },
  { key: 'task-12', emoji: '📦', background: 'linear-gradient(135deg, #e5e7eb, #6b7280)' },
];

/** 头像底色候选：无头像时按名字取色，保证同一个人颜色稳定 */
const FALLBACK_COLORS = ['#1677ff', '#13c2c2', '#52c41a', '#fa8c16', '#eb2f96', '#722ed1', '#fa541c'];

/**
 * 按标识查找预设头像
 * @param presets 预设集合
 * @param value 头像标识
 */
export function findAvatarPreset(
  presets: AvatarPreset[],
  value?: string | null,
): AvatarPreset | undefined {
  if (!value) {
    return undefined;
  }
  return presets.find((item) => item.key === value);
}

/** 判断是否为图片地址（非预设标识） */
export function isImageAvatar(value?: string | null): boolean {
  return Boolean(value && /^https?:\/\//i.test(value));
}

/**
 * 根据名字生成稳定的兜底底色
 * @param seed 姓名或用户主键
 */
export function fallbackAvatarColor(seed?: string | null): string {
  const text = seed ?? '';
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) % 100000;
  }
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

/**
 * 按种子挑选一个任务头像，用于发布需求时的默认值
 * @param seed 种子（可用标题长度或随机数）
 */
export function pickTaskAvatar(seed: number): string {
  return TASK_AVATARS[Math.abs(seed) % TASK_AVATARS.length].key;
}
