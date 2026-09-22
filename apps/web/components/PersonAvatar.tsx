'use client';

/**
 * 人物插画头像
 * 作用：用纯 SVG 画一个人物半身像（背景 + 上衣 + 头 + 发型），
 *      不依赖外部图床与图片资源，内网环境可离线使用
 * 说明：发型与配色由 lib/avatars.ts 的 PersonSpec 决定，18 个预设彼此可区分
 */
import type { PersonSpec } from '@/lib/avatars';

interface PersonAvatarProps {
  /** 人物插画参数 */
  person: PersonSpec;
  /** 头像尺寸（像素） */
  size: number;
}

/** 视口大小（内部坐标系固定，外层用 CSS 缩放） */
const VIEW = 100;

/**
 * 按发型生成头发路径
 * 说明：脸部椭圆为 cx=50 cy=46 rx=19 ry=21（上沿 y≈25），
 *      因此「头顶」部分统一收在 y=40 以上，把 y≈43 往下的脸留给眼睛，
 *      有两侧发帘的发型只覆盖脸的外缘（x < 37 或 x > 63），不遮挡五官
 * @param hairstyle 发型标识
 * @param hair 发色
 */
function renderHair(hairstyle: PersonSpec['hairstyle'], hair: string) {
  const common = { fill: hair } as const;
  /** 通用头顶：从 (29,40) 起弧到 (71,40)，向上鼓起到 y≈19，闭合成帽状 */
  const cap = <path d="M29 40a21 21 0 0 1 42 0z" {...common} />;
  switch (hairstyle) {
    // 短发：贴头皮的帽状
    case 'short':
      return cap;
    // 偏分：帽状 + 右侧一缕斜刘海
    case 'side':
      return (
        <>
          {cap}
          <path d="M60 30c7 5 10 12 10 19h-9z" {...common} />
        </>
      );
    // 寸头：更贴头骨的浅帽状
    case 'buzz':
      return <path d="M31 42a19 19 0 0 1 38 0z" {...common} />;
    // 齐耳短发：帽状 + 两侧发帘到下巴附近
    case 'bob':
      return (
        <>
          <path d="M29 40a21 21 0 0 1 42 0v22h-8V44H37v18h-8z" {...common} />
        </>
      );
    // 长发：帽状 + 两侧发帘垂到肩
    case 'long':
      return (
        <>
          <path d="M29 40a21 21 0 0 1 42 0v32h-8V44H37v28h-8z" {...common} />
        </>
      );
    // 丸子头：帽状 + 顶部发髻
    case 'bun':
      return (
        <>
          <circle cx="50" cy="22" r="8" {...common} />
          {cap}
        </>
      );
    // 马尾：帽状 + 右侧一束
    case 'ponytail':
      return (
        <>
          {cap}
          <path d="M68 42c7 7 9 16 7 26l-8-2c2-9 1-15-4-20z" {...common} />
        </>
      );
    // 卷发：帽状 + 三个蓬松的发球
    case 'curly':
      return (
        <>
          <circle cx="36" cy="30" r="9" {...common} />
          <circle cx="50" cy="24" r="11" {...common} />
          <circle cx="64" cy="30" r="9" {...common} />
          {cap}
        </>
      );
    default:
      return cap;
  }
}

/**
 * 渲染人物插画头像
 * @param props 插画参数与尺寸
 */
export default function PersonAvatar({ person, size }: PersonAvatarProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block' }}
    >
      {/* 肩部 / 上衣 */}
      <path d="M18 100c0-16 14-25 32-25s32 9 32 25z" fill={person.shirt} />
      {/* 脖子 */}
      <rect x="44" y="56" width="12" height="16" rx="5" fill={person.skin} />
      {/* 耳朵 */}
      <circle cx="29" cy="47" r="4.5" fill={person.skin} />
      <circle cx="71" cy="47" r="4.5" fill={person.skin} />
      {/* 脸 */}
      <ellipse cx="50" cy="46" rx="19" ry="21" fill={person.skin} />
      {/* 头发（画在脸之上，形成刘海与发帘） */}
      {renderHair(person.hairstyle, person.hair)}
      {/* 五官最后画，保证任何发型都不会挡住眼睛和嘴 */}
      <circle cx="42" cy="48" r="2.6" fill="#2b2b2b" />
      <circle cx="58" cy="48" r="2.6" fill="#2b2b2b" />
      {/* 嘴 */}
      <path d="M45 58q5 4 10 0" stroke="#b3644f" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}
