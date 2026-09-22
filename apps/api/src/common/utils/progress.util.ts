/**
 * 需求 / 项目进度计算
 * 作用：把项目状态折算成统一的完成度百分比，供进度条展示
 */
import { ProjectStatus } from '@prisma/client';

/** 各阶段的基础完成度（%） */
const STAGE_PROGRESS: Record<ProjectStatus, number> = {
  OPEN: 10, // 已发布，等待认领
  CLAIMED: 35, // 已认领，准备开发
  DEVELOPING: 55, // 开发中：55% 起步
  RELEASED: 100, // 已交付
  CLOSED: 100, // 已关闭（前端灰显）
};

/** 开发中阶段随 PR 合并情况最多可再增加的进度（%） */
const DEVELOPING_BONUS = 35;

/**
 * 计算项目完成度
 * @param status 项目状态
 * @param counts PR 数量统计（用于开发中阶段细化进度）
 */
export function calcProjectProgress(
  status: ProjectStatus,
  counts?: { pullReqs?: number; mergedPullReqs?: number },
): number {
  if (status === ProjectStatus.DEVELOPING) {
    const total = counts?.pullReqs ?? 0;
    const merged = counts?.mergedPullReqs ?? 0;
    const ratio = total > 0 ? Math.min(merged / total, 1) : 0;
    return Math.round(STAGE_PROGRESS.DEVELOPING + DEVELOPING_BONUS * ratio);
  }
  return STAGE_PROGRESS[status] ?? 0;
}
