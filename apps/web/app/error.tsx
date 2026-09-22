'use client';

/**
 * 全局错误边界
 * 作用：渲染或数据加载抛出未捕获异常时给出可恢复的提示，避免整页白屏
 */
import { Button, Result } from 'antd';
import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('页面渲染异常:', error);
  }, [error]);

  return (
    <Result
      status="500"
      title="页面加载失败"
      subTitle="页面在加载过程中发生异常，可尝试重试；若持续出现请联系管理员。"
      extra={[
        <Button type="primary" key="retry" onClick={reset}>
          重试
        </Button>,
        <Button key="home" href="/">
          返回工作台
        </Button>,
      ]}
    />
  );
}
