'use client';

/**
 * 贡献热力图组件
 * 作用：以 GitHub 风格展示逐日协作行为数量（发布需求、认领、反馈、PR 等）
 */
import type { HeatmapData } from '@/lib/types';
import { Empty, Skeleton, Tooltip } from 'antd';

/** 热力图配色：0 级到 4 级 */
const LEVEL_COLORS = ['#ebedf0', '#c6e48b', '#7bc96f', '#239a3b', '#196127'];

/** 单元格尺寸 */
const CELL = 13;
/** 单元格间距 */
const GAP = 3;

/**
 * 计算某天的活跃等级
 * @param count 当日行为数
 * @param max 区间内单日最大值
 */
function toLevel(count: number, max: number): number {
  if (count <= 0) {
    return 0;
  }
  if (max <= 1) {
    return 4;
  }
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4)));
}

/** 把逐日数据切成按周分组的列（每列 7 天，从周一开始） */
function toWeeks(days: HeatmapData['days']): HeatmapData['days'][] {
  const weeks: HeatmapData['days'][] = [];
  for (let index = 0; index < days.length; index += 7) {
    weeks.push(days.slice(index, index + 7));
  }
  return weeks;
}

/**
 * 渲染热力图
 * @param props.data 热力图数据
 * @param props.loading 是否加载中
 */
export default function Heatmap({
  data,
  loading,
}: {
  data: HeatmapData | null;
  loading?: boolean;
}) {
  if (loading && !data) {
    return <Skeleton active paragraph={{ rows: 3 }} />;
  }
  if (!data || data.days.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无贡献记录" />;
  }

  const weeks = toWeeks(data.days);
  const today = data.days[data.days.length - 1]?.date;

  // 月份标签：把同一月份连续的周合并成一个跨列标签
  const monthLabels: Array<{ label: string; span: number }> = [];
  weeks.forEach((week) => {
    const label = `${Number(week[0].date.slice(5, 7))}月`;
    const last = monthLabels[monthLabels.length - 1];
    if (last && last.label === label) {
      last.span += 1;
    } else {
      monthLabels.push({ label, span: 1 });
    }
  });

  return (
    <div className="heatmap">
      <div className="heatmap-scroll">
        <div className="heatmap-months" style={{ gridTemplateColumns: `repeat(${weeks.length}, ${CELL}px)` }}>
          {monthLabels.map((item, index) => (
            <span key={`${item.label}-${index}`} style={{ gridColumn: `span ${item.span}` }}>
              {item.span >= 3 ? item.label : ''}
            </span>
          ))}
        </div>

        <div className="heatmap-body">
          <div className="heatmap-weekdays">
            <span>一</span>
            <span>三</span>
            <span>五</span>
          </div>

          <div
            className="heatmap-grid"
            style={{
              gridTemplateRows: `repeat(7, ${CELL}px)`,
              gridAutoFlow: 'column',
              gap: GAP,
            }}
          >
            {weeks.map((week, weekIndex) =>
              week.map((day, dayIndex) => (
                <Tooltip
                  key={day.date}
                  title={`${day.date}：${day.count} 次协作行为`}
                  mouseEnterDelay={0.1}
                >
                  <div
                    className={`heatmap-cell${day.date === today ? ' is-today' : ''}`}
                    style={{
                      gridColumn: weekIndex + 1,
                      gridRow: dayIndex + 1,
                      background: LEVEL_COLORS[toLevel(day.count, data.max)],
                    }}
                  />
                </Tooltip>
              )),
            )}
          </div>
        </div>
      </div>

      <div className="heatmap-footer">
        <span className="text-muted">
          {data.from} ~ {data.to} 共 {data.total} 次协作行为 · 活跃 {data.activeDays} 天 · 当前连续{' '}
          {data.currentStreak} 天 · 最长连续 {data.longestStreak} 天
        </span>
        <span className="heatmap-legend">
          <span className="text-muted">少</span>
          {LEVEL_COLORS.map((color) => (
            <i key={color} style={{ background: color }} />
          ))}
          <span className="text-muted">多</span>
        </span>
      </div>
    </div>
  );
}
