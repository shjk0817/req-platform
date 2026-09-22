/**
 * 附件模块
 * 作用：装配附件上传与下载能力，并导出 UploadsService 供需求模块挂载附件
 */
import { PrismaModule } from '../prisma/prisma.module';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { Module, OnModuleInit } from '@nestjs/common';

@Module({
  imports: [PrismaModule],
  controllers: [UploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule implements OnModuleInit {
  constructor(private readonly uploadsService: UploadsService) {}

  /** 启动时确保上传目录存在，避免首次上传才报错 */
  async onModuleInit(): Promise<void> {
    await this.uploadsService.ensureDir();
  }
}
