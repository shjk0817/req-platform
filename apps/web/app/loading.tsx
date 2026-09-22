/**
 * 全局加载态
 * 作用：路由切换或页面数据加载期间展示占位，避免内容闪烁
 */
import { Spin } from 'antd';

export default function Loading() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 320,
      }}
    >
      <Spin size="large" />
    </div>
  );
}
