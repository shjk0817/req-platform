/**
 * 小白操作指引
 * 作用：集中维护各业务页的三步说明，避免每个页面各写一套口径。
 */

export interface PageGuide {
  title: string;
  steps: string[];
  example?: string;
}

/** 页面路径对应的简短指引 */
export const PAGE_GUIDES: Record<string, PageGuide> = {
  dashboard: {
    title: '工作台怎么用',
    steps: ['先看顶部「现在该做什么」', '完成后刷新，顶部会换成下一件事', '下面的数字只是统计，不必先处理'],
  },
  projects: {
    title: '需求池怎么用',
    steps: ['「我来做」表示你负责把它做完', '「我也想用」只表示你也需要，不会派开发任务', '看不懂时先打开详情里的阶段说明'],
    example: '例如你每天手工整理生产日报，可以点「写下一条需求」。',
  },
  projectNew: {
    title: '写需求怎么用',
    steps: ['按问题一步步回答，不需要写技术方案', '完成条件要能实际试出「可以」或「这里不行」', '发布前先看看有没有相似需求'],
    example: '好的条件：「能导出最近 30 天的数据，金额与系统一致」。',
  },
  projectDetail: {
    title: '需求详情怎么看',
    steps: ['顶部的阶段说明就是当前情况', '页面上的主按钮就是你现在该做的事', '不懂代码时只看需求说明、试用清单和反馈'],
  },
  feedbacks: {
    title: '反馈怎么写',
    steps: ['先选最接近的一句话', '写清楚你做了什么、看到了什么', '负责人回复后，你可以继续补充或确认已解决'],
  },
  profile: {
    title: '个人资料怎么用',
    steps: ['点击头像可以更换预设或上传自定义头像', '账号信息用于确认你的平台身份', '需要改密码时点击「修改密码」'],
  },
  notifications: {
    title: '通知怎么用',
    steps: ['点击通知会直接到对应事项', '看完后会自动标记已读', '顶部数字只代表还没看的通知数量'],
  },
  admin: {
    title: '用户审核怎么用',
    steps: ['通过代表对方可以登录并获得代码账号', '拒绝时写一句原因，对方才知道怎么处理', '初始代码密码只展示一次，请提醒对方及时修改'],
  },
};

/** 根据当前路径取指引 */
export function getPageGuide(pathname: string): PageGuide | null {
  if (pathname === '/') return PAGE_GUIDES.dashboard;
  if (pathname === '/projects/new') return PAGE_GUIDES.projectNew;
  if (pathname.startsWith('/projects/')) return PAGE_GUIDES.projectDetail;
  if (pathname === '/projects') return PAGE_GUIDES.projects;
  if (pathname.startsWith('/feedbacks')) return PAGE_GUIDES.feedbacks;
  if (pathname.startsWith('/profile')) return PAGE_GUIDES.profile;
  if (pathname.startsWith('/notifications')) return PAGE_GUIDES.notifications;
  if (pathname.startsWith('/admin')) return PAGE_GUIDES.admin;
  return null;
}
