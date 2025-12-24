import { plainToInstance } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, IsUrl, validateSync } from 'class-validator';

class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  LICENSE_DATABASE_URL: string;

  @IsString()
  @IsNotEmpty()
  ENCRYPTION_KEY: string;

  @IsString()
  @IsNotEmpty()
  ADMIN_API_KEY: string;

  @IsString()
  @IsNotEmpty()
  STRIPE_SECRET_KEY: string;

  @IsString()
  @IsNotEmpty()
  STRIPE_WEBHOOK_SECRET: string;

  @IsString()
  @IsNotEmpty()
  STRIPE_PRODUCT_ID: string;

  @IsString()
  @IsNotEmpty()
  RESEND_API_KEY: string;

  @IsOptional()
  @IsString()
  PATREON_CLIENT_ID?: string;

  @IsOptional()
  @IsString()
  PATREON_CLIENT_SECRET?: string;

  @IsOptional()
  @IsString()
  PATREON_WEBHOOK_SECRET?: string;

  @IsOptional()
  @IsUrl()
  LICENSE_API_URL?: string;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const _missingVars = errors.map((err) => Object.keys(err.constraints || {}).join(', '));
    throw new Error(
      `❌ Configuration validation failed:\n${errors.map((e) => `  - ${e.property}: ${Object.values(e.constraints || {}).join(', ')}`).join('\n')}`
    );
  }

  return validatedConfig;
}
