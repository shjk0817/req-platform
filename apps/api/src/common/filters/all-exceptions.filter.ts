/**
 * 全局异常过滤器
 * 作用：统一错误响应结构，屏蔽内部堆栈信息，便于前端处理
 */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  /** 捕获异常并输出统一结构的错误响应 */
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const headerValue =
      typeof request.header === 'function'
        ? request.header('x-request-id')
        : request.headers?.['x-request-id'];
    const requestId = Array.isArray(headerValue) ? headerValue[0] : headerValue ?? 'unknown';

    const prismaCode =
      exception instanceof Prisma.PrismaClientKnownRequestError ? exception.code : undefined;
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : prismaCode === 'P2002'
          ? HttpStatus.CONFLICT
          : prismaCode === 'P2025'
            ? HttpStatus.NOT_FOUND
            : HttpStatus.INTERNAL_SERVER_ERROR;

    let message = '服务器内部错误';
    let code = prismaCode ? `PRISMA_${prismaCode}` : `HTTP_${status}`;
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const detail = (res as { message?: string | string[] }).message;
        message = Array.isArray(detail) ? detail.join('; ') : detail ?? exception.message;
        const detailCode = (res as { code?: unknown }).code;
        if (typeof detailCode === 'string' && detailCode.trim()) {
          code = detailCode;
        }
      }
    } else if (prismaCode === 'P2002') {
      message = '数据已存在，请勿重复提交';
    } else if (prismaCode === 'P2025') {
      message = '请求的数据不存在';
    } else if (exception instanceof Error) {
      // 非 HTTP 异常只在服务端记录，不返回给客户端
      this.logger.error(`未处理异常: ${exception.message}`, exception.stack);
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(`${request.method} ${request.url} -> ${status} ${message}`);
    }

    response.status(status).json({
      statusCode: status,
      code,
      requestId,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
