import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthService, LoginResponse } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { CreateAdminDto } from './dto/create-admin.dto';
import { LoginDto } from './dto/login.dto';
import { AdminUserEntity } from './entities/admin-user.entity';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  async login(@Body() loginDto: LoginDto): Promise<LoginResponse> {
    return this.authService.login(loginDto);
  }

  @Get('me')
  async getCurrentUser(@CurrentUser() user: AdminUserEntity): Promise<AdminUserEntity> {
    return user;
  }

  @Post('admins')
  async createAdmin(
    @Body() createAdminDto: CreateAdminDto,
    @CurrentUser() user: AdminUserEntity,
  ): Promise<AdminUserEntity> {
    return this.authService.createAdmin(createAdminDto, user.id);
  }

  @Get('admins')
  async getAllAdmins(): Promise<AdminUserEntity[]> {
    return this.authService.getAllAdmins();
  }

  @Post('admins/:id/toggle-status')
  async toggleAdminStatus(
    @Param('id') id: string,
    @CurrentUser() user: AdminUserEntity,
  ): Promise<AdminUserEntity> {
    return this.authService.toggleAdminStatus(id, user.id);
  }
}
