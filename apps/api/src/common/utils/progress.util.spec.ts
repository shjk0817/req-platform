/**
 * 项目进度计算测试
 * 作用：锁定等待认领阶段从 0% 开始，避免需求池误导用户认为已经开始开发
 */
import { ProjectStatus } from '@prisma/client';
import { calcProjectProgress } from './progress.util';

describe('calcProjectProgress', () => {
  it('等待认领时应显示 0%', () => {
    expect(calcProjectProgress(ProjectStatus.OPEN)).toBe(0);
  });

  it('已认领但尚未开发时应显示阶段进度', () => {
    expect(calcProjectProgress(ProjectStatus.CLAIMED)).toBe(35);
  });

  it('开发中会根据已合并 PR 增加进度', () => {
    expect(calcProjectProgress(ProjectStatus.DEVELOPING, { pullReqs: 2, mergedPullReqs: 1 })).toBe(73);
  });
});
