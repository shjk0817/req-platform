/**
 * 统计服务
 * 作用：汇总平台内的协作行为（发布需求、认领、关注需求、反馈、评论、PR），
 *      生成类似 GitHub 的贡献热力图数据
 */
import { PrismaService } from '../prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** 热力图单日数据 */
interface HeatmapDay {
  /** 日期（YYYY-MM-DD） */
  date: string;
  /** 当日行为数 */
  count: number;
}

/** 用户贡献概览 */
interface ContributionSummary {
  /** 发布需求 */
  projects: number;
  /** 认领项目 */
  claims: number;
  /** 加入共同需求人 */
  requesters: number;
  /** 提交反馈 */
  feedbacks: number;
  /** 反馈评论 */
  comments: number;
  /** 提交 PR */
  pullRequests: number;
}

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 生成热力图数据
   * @param userId 统计对象；为空表示全平台汇总
   * @param months 统计最近多少个月
   */
  async heatmap(userId: string | undefined, months: number) {
    const to = this.startOfDay(new Date());
    // 起始时间往前多取一周，保证首列是完整的自然周
    const from = new Date(to);
    from.setMonth(from.getMonth() - months + 1);
    from.setDate(from.getDate() - ((from.getDay() + 6) % 7)); // 对齐到周一

    const rows = await this.prisma.$queryRaw<Array<{ date: string; count: bigint }>>(
      Prisma.sql`
        SELECT to_char(day, 'YYYY-MM-DD') AS date, COUNT(*)::bigint AS count
        FROM (
          SELECT date_trunc('day', "createdAt") AS day FROM "projects"
            WHERE "createdAt" >= ${from} AND (${userId ?? null}::text IS NULL OR "creatorId" = ${userId ?? null})
          UNION ALL
          SELECT date_trunc('day', "createdAt") FROM "project_claims"
            WHERE "createdAt" >= ${from} AND (${userId ?? null}::text IS NULL OR "userId" = ${userId ?? null})
          UNION ALL
          SELECT date_trunc('day', "createdAt") FROM "project_requesters"
            WHERE "createdAt" >= ${from} AND (${userId ?? null}::text IS NULL OR "userId" = ${userId ?? null})
          UNION ALL
          SELECT date_trunc('day', "createdAt") FROM "feedbacks"
            WHERE "createdAt" >= ${from} AND (${userId ?? null}::text IS NULL OR "userId" = ${userId ?? null})
          UNION ALL
          SELECT date_trunc('day', "createdAt") FROM "feedback_comments"
            WHERE "createdAt" >= ${from} AND (${userId ?? null}::text IS NULL OR "userId" = ${userId ?? null})
          UNION ALL
          SELECT date_trunc('day', "createdAt") FROM "pull_requests"
            WHERE "createdAt" >= ${from} AND (${userId ?? null}::text IS NULL OR "authorId" = ${userId ?? null})
        ) AS activity
        GROUP BY day
        ORDER BY day
      `,
    );

    const counted = new Map<string, number>();
    rows.forEach((row) => counted.set(row.date, Number(row.count)));

    const days: HeatmapDay[] = this.fillDays(from, to, counted);
    const totals = days.map((item) => item.count);
    const summary = await this.summary(userId);

    return {
      from: this.formatDate(from),
      to: this.formatDate(to),
      total: totals.reduce((sum, value) => sum + value, 0),
      max: totals.length > 0 ? Math.max(...totals) : 0,
      activeDays: totals.filter((value) => value > 0).length,
      currentStreak: this.currentStreak(days),
      longestStreak: this.longestStreak(days),
      days,
      summary,
    };
  }

  /**
   * 统计各类行为的累计数量
   * @param userId 统计对象；为空表示全平台
   */
  async summary(userId?: string): Promise<ContributionSummary> {
    const own = userId ? { userId } : {};
    const [projects, claims, requesters, feedbacks, comments, pullRequests] = await Promise.all([
      this.prisma.project.count({ where: userId ? { creatorId: userId } : {} }),
      this.prisma.projectClaim.count({ where: own }),
      this.prisma.projectRequester.count({ where: own }),
      this.prisma.feedback.count({ where: own }),
      this.prisma.feedbackComment.count({ where: own }),
      this.prisma.pullRequest.count({ where: userId ? { authorId: userId } : {} }),
    ]);
    return { projects, claims, requesters, feedbacks, comments, pullRequests };
  }

  /** 补全区间内缺失的日期，保证前端可以直接铺满网格 */
  private fillDays(from: Date, to: Date, counted: Map<string, number>): HeatmapDay[] {
    const days: HeatmapDay[] = [];
    const cursor = new Date(from);
    while (cursor <= to) {
      const key = this.formatDate(cursor);
      days.push({ date: key, count: counted.get(key) ?? 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }

  /** 当前连续活跃天数（今天没动但昨天有，仍算连续） */
  private currentStreak(days: HeatmapDay[]): number {
    let index = days.length - 1;
    if (index >= 0 && days[index].count === 0) {
      index -= 1;
    }
    let streak = 0;
    while (index >= 0 && days[index].count > 0) {
      streak += 1;
      index -= 1;
    }
    return streak;
  }

  /** 历史最长连续活跃天数 */
  private longestStreak(days: HeatmapDay[]): number {
    let longest = 0;
    let current = 0;
    days.forEach((day) => {
      current = day.count > 0 ? current + 1 : 0;
      longest = Math.max(longest, current);
    });
    return longest;
  }

  /** 取当日零点，避免时分秒影响按天聚合 */
  private startOfDay(date: Date): Date {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  /** 格式化为 YYYY-MM-DD */
  private formatDate(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
}
