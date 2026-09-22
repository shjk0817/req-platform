/**
 * 全局异常过滤器单测
 * 作用：验证错误响应结构与 Prisma 错误码映射是否符合预期
 */
import { AllExceptionsFilter } from './all-exceptions.filter';
import { ArgumentsHost, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

/** 构造最小可用的 ArgumentsHost，用于捕获 status / json 的调用参数 */
function createHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }) as unknown as Response,
      getRequest: () => ({ method: 'POST', url: '/api/projects' }) as Request,
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

/** 构造一个 Prisma 已知请求错误 */
function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('internal detail', {
    code,
    clientVersion: '5.22.0',
  });
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  beforeEach(() => {
    // 这些用例会刻意触发错误日志，静音以免淹没测试输出
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('P2002 唯一约束冲突映射为 409，且不泄露原始错误信息', () => {
    const { host, status, json } = createHost();

    filter.catch(prismaError('P2002'), host);

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 409, message: '数据已存在，请勿重复提交' }),
    );
  });

  it('P2025 记录不存在映射为 404', () => {
    const { host, status } = createHost();

    filter.catch(prismaError('P2025'), host);

    expect(status).toHaveBeenCalledWith(404);
  });

  it('未登记的错误码仍按 500 处理', () => {
    const { host, status, json } = createHost();

    filter.catch(prismaError('P2034'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ message: '服务器内部错误' }));
  });

  it('HttpException 保留自身状态码与提示', () => {
    const { host, status, json } = createHost();

    filter.catch(new NotFoundException('项目不存在'), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404, message: '项目不存在' }));
  });

  it('未知异常统一返回 500 且不暴露堆栈', () => {
    const { host, status, json } = createHost();

    filter.catch(new Error('数据库连接串含敏感信息'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500, message: '服务器内部错误' }));
  });
});
