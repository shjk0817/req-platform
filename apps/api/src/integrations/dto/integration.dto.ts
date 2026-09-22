/**
 * 机器客户端令牌 DTO
 * 作用：限制令牌名称、有效期和权限范围，避免客户端获得隐含的管理员能力
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { INTEGRATION_SCOPES, IntegrationScope } from '../integration.constants';

export class CreateIntegrationTokenDto {
  @ApiProperty({ description: '令牌用途名称', example: '我的 Cursor 助手' })
  @IsString()
  @MinLength(1, { message: '令牌名称不能为空' })
  @MaxLength(80, { message: '令牌名称最多 80 个字符' })
  name!: string;

  @ApiPropertyOptional({ description: '权限范围', enum: INTEGRATION_SCOPES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(INTEGRATION_SCOPES.length, { message: '权限范围过多' })
  @ArrayUnique()
  @IsIn(INTEGRATION_SCOPES, { each: true, message: '权限范围不合法' })
  scopes?: IntegrationScope[];

  @ApiPropertyOptional({ description: '有效天数，留空表示不过期', example: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  expiresInDays?: number;
}
