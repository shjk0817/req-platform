/**
 * 用户模块
 * 作用：装配用户资料与审核相关能力
 */
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { GiteaModule } from '../gitea/gitea.module';
import { UploadsModule } from '../uploads/uploads.module';
import { Module } from '@nestjs/common';

@Module({
  imports: [GiteaModule, UploadsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
