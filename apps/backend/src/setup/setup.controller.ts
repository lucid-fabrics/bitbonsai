import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/guards/public.decorator';
import { InitializeSetupDto } from './dto/initialize-setup.dto';
import { SetupStatusDto } from './dto/setup-status.dto';
import { SetupService } from './setup.service';

@ApiTags('setup')
@Controller('setup')
export class SetupController {
  constructor(private readonly setupService: SetupService) {}

  @Get('status')
  @Public()
  @ApiOperation({
    summary: 'Check setup status',
    description:
      'Check if the initial setup has been completed. Setup is considered complete if at least one user exists in the database. This endpoint is public and does not require authentication.',
  })
  @ApiOkResponse({ description: 'Setup status retrieved', type: SetupStatusDto })
  async getSetupStatus(): Promise<SetupStatusDto> {
    return this.setupService.getSetupStatus();
  }

  @Post('initialize')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 3600000 } }) // SECURITY: 5 attempts per hour
  @ApiOperation({
    summary: 'Initialize system setup',
    description:
      'Initialize the system with the first admin user and security settings. This endpoint can only be called once when no users exist. It creates the first admin user with a hashed password and configures the initial security settings. This endpoint is public and does not require authentication. Rate limited to 5 attempts per hour per IP to prevent brute force attacks.',
  })
  @ApiCreatedResponse({ description: 'Setup initialized successfully' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  @ApiBadRequestResponse({
    description: 'Setup has already been completed or validation failed',
  })
  async initializeSetup(@Body() dto: InitializeSetupDto): Promise<{ message: string }> {
    return this.setupService.initializeSetup(dto);
  }

  @Delete('reset')
  @Public()
  @ApiOperation({
    summary: 'Reset setup (Development Only)',
    description:
      '⚠️ DEVELOPMENT ONLY - Resets the setup to allow running the first-time setup wizard again. ' +
      'This endpoint deletes all users and resets the setup completion flag. ' +
      'This endpoint will throw an error if called in production. ' +
      'This endpoint is public and does not require authentication.',
  })
  @ApiOkResponse({ description: 'Setup reset successfully' })
  @ApiForbiddenResponse({ description: 'Not allowed in production' })
  async resetSetup(): Promise<{ message: string }> {
    return this.setupService.resetSetup();
  }
}
