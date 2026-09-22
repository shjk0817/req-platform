/**
 * 预设头像常量
 * 作用：与前端 lib/avatars.ts 保持一致，作为头像取值的唯一校验依据
 * 说明：平台部署在内网，头像不使用外部图床，统一用「预设标识 + 前端渲染」的方式
 *      取值形如 user-01 / task-01；同时兼容 https 图片地址，便于后续接入上传功能
 */

/** 用户（同事）可选头像标识 */
export const USER_AVATAR_PRESETS = [
  'user-01',
  'user-02',
  'user-03',
  'user-04',
  'user-05',
  'user-06',
  'user-07',
  'user-08',
  'user-09',
  'user-10',
  'user-11',
  'user-12',
  'user-13',
  'user-14',
  'user-15',
  'user-16',
  'user-17',
  'user-18',
] as const;

/** 任务（需求项目）可选头像标识 */
export const PROJECT_AVATAR_PRESETS = [
  'task-01',
  'task-02',
  'task-03',
  'task-04',
  'task-05',
  'task-06',
  'task-07',
  'task-08',
  'task-09',
  'task-10',
  'task-11',
  'task-12',
] as const;

/** 头像取值（预设标识或图片地址） */
export type AvatarValue = string;

/**
 * 判断头像取值是否合法
 * @param value 待校验的头像取值
 * @param presets 允许的预设标识集合
 */
export function isAllowedAvatar(
  value: string | null | undefined,
  presets: readonly string[],
): boolean {
  if (!value) {
    return true;
  }
  if (presets.includes(value)) {
    return true;
  }
  return /^https:\/\/\S+$/i.test(value);
}

/**
 * 按索引取一个预设头像，用于发布需求等场景的默认值
 * @param presets 预设集合
 * @param seed 用于取模的随机/种子数
 */
export function pickPresetAvatar(presets: readonly string[], seed: number): string {
  const index = Math.abs(seed) % presets.length;
  return presets[index];
}
