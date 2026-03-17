import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class UnmountShareDto {
  @ApiPropertyOptional({
    description: 'Force unmount even if busy',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  force?: boolean;
}
