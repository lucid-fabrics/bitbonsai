import { AdminRole } from '@prisma/license-client';
import { IsEmail, IsEnum, IsString, MinLength } from 'class-validator';

export class CreateAdminDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  name: string;

  @IsEnum(AdminRole)
  role: AdminRole;
}
