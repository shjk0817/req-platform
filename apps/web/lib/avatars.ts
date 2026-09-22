/**
 * 预设头像
 * 作用：与后端 common/constants/avatars.ts 保持一致，
 *      同事头像使用内置的「人物插画」（不用外部图床，内网可用），
 *      任务头像继续使用 emoji + 纸张底色。
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
  /** 底色（人物插画或任务头像的背景） */
  background: string;
  /** 展示用的图形：任务头像使用 emoji */
  emoji?: string;
  /** 人物插画参数（同事头像使用） */
  person?: PersonSpec;
}

/** 同事可选头像：统一为人物插画，避免「动物头像」的观感 */
export const USER_AVATARS: AvatarPreset[] = [
  { key: 'user-01', background: '#d9e4de', person: { skin: '#f2c9a8', hair: '#2f2a26', shirt: '#34785c', hairstyle: 'short' } },
  { key: 'user-02', background: '#ead7c3', person: { skin: '#f6d5b8', hair: '#4a3728', shirt: '#c08532', hairstyle: 'bob' } },
  { key: 'user-03', background: '#deddd8', person: { skin: '#eec19d', hair: '#1f1b18', shirt: '#595952', hairstyle: 'buzz' } },
  { key: 'user-04', background: '#ead6d0', person: { skin: '#f7d0b0', hair: '#5b3a29', shirt: '#cf2d56', hairstyle: 'long' } },
  { key: 'user-05', background: '#ded8d0', person: { skin: '#e8b48c', hair: '#2b2320', shirt: '#84847e', hairstyle: 'curly' } },
  { key: 'user-06', background: '#d5e2d8', person: { skin: '#f4cba6', hair: '#6b4423', shirt: '#34785c', hairstyle: 'ponytail' } },
  { key: 'user-07', background: '#e9dfc8', person: { skin: '#d9a273', hair: '#1a1512', shirt: '#c08532', hairstyle: 'side' } },
  { key: 'user-08', background: '#d2e1df', person: { skin: '#f3c9a5', hair: '#3f2f24', shirt: '#34785c', hairstyle: 'bun' } },
  { key: 'user-09', background: '#dedbd5', person: { skin: '#c88a5a', hair: '#161210', shirt: '#84847e', hairstyle: 'buzz' } },
  { key: 'user-10', background: '#ead8d4', person: { skin: '#f7d6bb', hair: '#7a4a26', shirt: '#cf2d56', hairstyle: 'bob' } },
  { key: 'user-11', background: '#d9e1df', person: { skin: '#eabf96', hair: '#241d18', shirt: '#34785c', hairstyle: 'short' } },
  { key: 'user-12', background: '#dfe3d1', person: { skin: '#a9673a', hair: '#0f0c0a', shirt: '#34785c', hairstyle: 'curly' } },
  { key: 'user-13', background: '#e8d8c8', person: { skin: '#f5cfa8', hair: '#4b3621', shirt: '#c08532', hairstyle: 'long' } },
  { key: 'user-14', background: '#e0d9d4', person: { skin: '#e5b183', hair: '#33261c', shirt: '#84847e', hairstyle: 'side' } },
  { key: 'user-15', background: '#d3e1db', person: { skin: '#f8d8bb', hair: '#8a5a2b', shirt: '#34785c', hairstyle: 'ponytail' } },
  { key: 'user-16', background: '#d8dcd9', person: { skin: '#c98d5f', hair: '#1c1613', shirt: '#84847e', hairstyle: 'bun' } },
  { key: 'user-17', background: '#dcdcd7', person: { skin: '#f1c6a4', hair: '#514035', shirt: '#595952', hairstyle: 'short' } },
  { key: 'user-18', background: '#ead7cc', person: { skin: '#eab992', hair: '#2a211c', shirt: '#c08532', hairstyle: 'bob' } },
];

/** 任务（需求）可选头像：继续用 emoji，语义清晰且与需求主题对应 */
export const TASK_AVATARS: AvatarPreset[] = [
  { key: 'task-01', emoji: '📊', background: '#d9e4de' },
  { key: 'task-02', emoji: '🛠️', background: '#deddd8' },
  { key: 'task-03', emoji: '📈', background: '#d5e2d8' },
  { key: 'task-04', emoji: '🤖', background: '#dedbd5' },
  { key: 'task-05', emoji: '🔍', background: '#e9dfc8' },
  { key: 'task-06', emoji: '📱', background: '#d2e1df' },
  { key: 'task-07', emoji: '🧪', background: '#ead8d4' },
  { key: 'task-08', emoji: '📮', background: '#e8d8c8' },
  { key: 'task-09', emoji: '🗂️', background: '#ead7cc' },
  { key: 'task-10', emoji: '🎨', background: '#e0d9d4' },
  { key: 'task-11', emoji: '⚙️', background: '#d8dcd9' },
  { key: 'task-12', emoji: '📦', background: '#dcdcd7' },
];

/** 头像底色候选：无头像时按名字取色，保证同一个人颜色稳定 */
const FALLBACK_COLORS = ['#34785c', '#c08532', '#84847e', '#cf2d56', '#7a7974'];

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
  return Boolean(value && /^(?:https?:\/\/|\/)/i.test(value));
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
