/**
 * 404 页面
 * 作用：访问不存在的路径时给出明确提示与返回入口
 */
import { Button, Result } from 'antd';
import Link from 'next/link';

export default function NotFound() {
  return (
    <Result
      status="404"
      title="页面不存在"
      subTitle="你访问的页面已被移除，或地址输入有误。"
      extra={
        <Link href="/">
          <Button type="primary">返回工作台</Button>
        </Link>
      }
    />
  );
}
