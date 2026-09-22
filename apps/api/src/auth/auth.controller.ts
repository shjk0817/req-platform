/**
 * 认证控制器
 * 作用：暴露注册、登录、个人信息与修改密码接口
 */
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** 员工注册（无需登录） */
  @Public()
  @Post('register')
  @ApiOperation({ summary: '员工注册，提交后需管理员审核' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /** 登录并获取访问令牌 */
  @Public()
  @Post('login')
  @ApiOperation({ summary: '账号密码登录' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /** 获取开发环境账号选择器数据，随后仍走普通密码登录 */
  @Public()
  @Get('dev-users')
  @ApiOperation({ summary: '获取开发环境可选账号' })
  devUsers() {
    return this.authService.getDevUsers();
  }

  /** 查询当前登录用户信息 */
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前登录用户信息' })
  me(@CurrentUser('id') userId: string) {
    return this.authService.getProfile(userId);
  }

  /** 修改当前用户密码 */
  @Put('password')
  @ApiBearerAuth()
  @ApiOperation({ summary: '修改登录密码' })
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.id, dto);
  }
}
