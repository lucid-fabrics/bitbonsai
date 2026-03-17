import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class CancelJobDto {
  @ApiProperty({
    description:
      'If true, blacklists the file to prevent automatic re-encoding. ' +
      'Blacklisted files can be unblacklisted later to retry encoding.',
    example: false,
    required: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  blacklist?: boolean;
}
