'use client';

/**
 * Markdown 内容展示组件
 * 作用：在不执行仓库 HTML 的前提下，保留 README/教程的标题、列表、代码和链接可读性
 */
import { Typography } from 'antd';
import { Fragment, ReactNode, useMemo } from 'react';

/** 把普通文本中的图片和外链拆成安全的展示片段 */
function renderInlineText(text: string): ReactNode {
  const parts = text.split(/(!\[[^\]]*\]\((?:https?:\/\/|\/)[^)\s]+\)|https?:\/\/[^\s)]+)/g);
  return parts.map((part, index) => {
    const imageMatch = part.match(/^!\[([^\]]*)\]\(((?:https?:\/\/|\/)[^)\s]+)\)$/i);
    if (imageMatch) {
      return (
        <img
          key={`${part}-${index}`}
          src={imageMatch[2]}
          alt={imageMatch[1] || '需求图片'}
          className="markdown-image"
        />
      );
    }
    return /^https?:\/\//i.test(part) ? (
      <a key={`${part}-${index}`} href={part} target="_blank" rel="noreferrer">
        {part}
      </a>
    ) : (
      <Fragment key={`${part}-${index}`}>{part}</Fragment>
    );
  });
}

/** 将 Markdown 的有限子集转换成 React 节点 */
function renderMarkdown(content: string): ReactNode[] {
  let inCodeBlock = false;
  return content.split(/\r?\n/).map((line, index) => {
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      return null;
    }
    if (inCodeBlock) {
      return (
        <code key={index} className="markdown-code-line">
          {line || ' '}
        </code>
      );
    }
    if (/^###\s+/.test(line)) {
      return <h4 key={index}>{renderInlineText(line.replace(/^###\s+/, ''))}</h4>;
    }
    if (/^##\s+/.test(line)) {
      return <h3 key={index}>{renderInlineText(line.replace(/^##\s+/, ''))}</h3>;
    }
    if (/^#\s+/.test(line)) {
      return <h2 key={index}>{renderInlineText(line.replace(/^#\s+/, ''))}</h2>;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      return <li key={index}>{renderInlineText(line.replace(/^\s*[-*]\s+/, ''))}</li>;
    }
    if (!line.trim()) {
      return <div key={index} className="markdown-spacer" />;
    }
    return <p key={index}>{renderInlineText(line)}</p>;
  });
}

export default function MarkdownContent({ content }: { content: string }) {
  const nodes = useMemo(() => renderMarkdown(content), [content]);

  return (
    <div className="markdown-content" aria-label="文档内容">
      {nodes}
    </div>
  );
}

/** 成果页空文档说明 */
export function EmptyDeliverableDocument({ label }: { label: string }) {
  return <Typography.Text type="secondary">仓库中还没有 {label}，开发同事可以补充后在这里展示。</Typography.Text>;
}
