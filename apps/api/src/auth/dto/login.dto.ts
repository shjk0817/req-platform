/**
 * 登录请求 DTO
 * 作用：校验登录时提交的邮箱与密码
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ description: '公司邮箱', example: 'zhangsan@example.com' })
  @IsEmail({}, { message: '请输入正确的邮箱地址' })
  email!: string;

  @ApiProperty({ description: '登录密码' })
  @IsString()
  @MinLength(6, { message: '密码至少 6 位' })
  password!: string;
}
