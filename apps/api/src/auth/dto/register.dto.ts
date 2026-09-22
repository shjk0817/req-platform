/**
 * 注册请求 DTO
 * 作用：校验员工注册时提交的信息
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ description: '公司邮箱', example: 'zhangsan@example.com' })
  @IsEmail({}, { message: '请输入正确的邮箱地址' })
  email!: string;

  @ApiProperty({ description: '姓名', example: '张三' })
  @IsString()
  @MinLength(2, { message: '姓名至少 2 个字符' })
  @MaxLength(32, { message: '姓名最多 32 个字符' })
  name!: string;

  @ApiProperty({ description: '登录密码', example: 'Passw0rd123' })
  @IsString()
  @MinLength(8, { message: '密码至少 8 位' })
  @MaxLength(64, { message: '密码最多 64 位' })
  password!: string;

  @ApiPropertyOptional({ description: '所属部门', example: '生产部' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  department?: string;

  @ApiPropertyOptional({ description: '能力标签（用于被推荐为开发者）', example: ['前端', 'Node.js'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: '能力标签最多 10 个' })
  @IsString({ each: true })
  skills?: string[];
}
