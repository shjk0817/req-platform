'use client';

/**
 * 页面操作指引
 * 作用：为不会开发的同事提供当前页面最多三步的操作说明，并记住关闭状态。
 */
import type { PageGuide } from '@/lib/guides';
import { BulbOutlined, CloseOutlined } from '@ant-design/icons';
import { Button, Card, Collapse, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';

interface GuidePopoverProps {
  guide: PageGuide;
  storageKey: string;
}

/** 渲染可关闭的页面三步指引 */
export default function GuidePopover({ guide, storageKey }: GuidePopoverProps) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    setOpen(window.localStorage.getItem(storageKey) !== 'closed');
  }, [storageKey]);

  if (!open) {
    return (
      <Button
        className="guide-reopen"
        type="primary"
        shape="round"
        icon={<BulbOutlined />}
        onClick={() => {
          window.localStorage.removeItem(storageKey);
          setOpen(true);
        }}
      >
        我不会操作
      </Button>
    );
  }

  return (
    <Card
      className="guide-popover"
      size="small"
      title={
        <Space>
          <BulbOutlined />
          <span>{guide.title}</span>
        </Space>
      }
      extra={
        <Button
          type="text"
          size="small"
          icon={<CloseOutlined />}
          aria-label="关闭操作指引"
          onClick={() => {
            window.localStorage.setItem(storageKey, 'closed');
            setOpen(false);
          }}
        />
      }
    >
      <ol className="guide-list">
        {guide.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {guide.example && (
        <Collapse
          ghost
          items={[{ key: 'example', label: '看一个例子', children: <Typography.Text type="secondary">{guide.example}</Typography.Text> }]}
        />
      )}
    </Card>
  );
}
