/**
 * 修改密码 DTO
 * 作用：校验用户主动修改密码时提交的信息
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ description: '原密码' })
  @IsString()
  @MinLength(6, { message: '原密码至少 6 位' })
  oldPassword!: string;

  @ApiProperty({ description: '新密码' })
  @IsString()
  @MinLength(8, { message: '新密码至少 8 位' })
  @MaxLength(64, { message: '新密码最多 64 位' })
  newPassword!: string;
}
