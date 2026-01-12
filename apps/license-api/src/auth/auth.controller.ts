import {
  Body,
  Controller,
  Get,
  Patch,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService, LoginResponse } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { CreateAdminDto } from './dto/create-admin.dto';
import { LoginDto } from './dto/login.dto';
import { AdminUserEntity } from './entities/admin-user.entity';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  async login(@Body() loginDto: LoginDto): Promise<LoginResponse> {
    return this.authService.login(loginDto);
  }

  @Post('admin')
  async createAdmin(
    @Body() createAdminDto: CreateAdminDto,
    @CurrentUser() currentUser: AdminUserEntity,
  ): Promise<AdminUserEntity> {
    return this.authService.createAdmin(createAdminDto, currentUser.id);
  }

  @Get('me')
  async getMe(@CurrentUser() currentUser: AdminUserEntity): Promise<AdminUserEntity> {
    return currentUser;
  }

  @Get('admins')
  async getAllAdmins(): Promise<AdminUserEntity[]> {
    return this.authService.getAllAdmins();
  }

  @Patch('admins/:id/toggle')
  async toggleAdminStatus(
    @Param('id') id: string,
    @CurrentUser() currentUser: AdminUserEntity,
  ): Promise<AdminUserEntity> {
    return this.authService.toggleAdminStatus(id, currentUser.id);
  }
}
