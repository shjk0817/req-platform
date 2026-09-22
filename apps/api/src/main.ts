/**
 * 应用入口
 * 作用：初始化 Nest 应用，装配全局前缀、参数校验、异常处理与接口文档
 */
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * 启动 HTTP 服务
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  // rawBody 用于校验 Gitea Webhook 的 HMAC 签名
  const app = await NestFactory.create(AppModule, { rawBody: true });

  const config = app.get(ConfigService);
  const port = config.get<number>('port') ?? 4000;

  // 统一 API 前缀
  app.setGlobalPrefix('api');

  // 全局参数校验与类型转换
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // 统一异常响应结构
  app.useGlobalFilters(new AllExceptionsFilter());

  // 跨域：开发环境放开，生产环境由 Caddy 同域代理
  app.enableCors({ origin: true, credentials: true });

  // 接口文档：仅在非生产环境暴露，便于内部联调
  if (config.get<string>('env') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('内部需求协作平台 API')
      .setDescription('需求发布、认领、开发协作与反馈迭代的接口文档')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  }

  await app.listen(port, '0.0.0.0');
  logger.log(`平台后端已启动: http://0.0.0.0:${port}/api`);
}

void bootstrap();
