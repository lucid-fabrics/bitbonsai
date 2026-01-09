import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, IsUrl } from 'class-validator';

export class CreateCheckoutDto {
  @ApiProperty({
    description: 'Customer email address',
    example: 'user@example.com',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'Stripe price ID from pricing tier',
    example: 'price_1ABC123xyz',
  })
  @IsString()
  priceId: string;

  @ApiProperty({
    description: 'URL to redirect after successful payment',
    example: 'https://bitbonsai.io/success',
  })
  @IsUrl()
  successUrl: string;

  @ApiProperty({
    description: 'URL to redirect if payment cancelled',
    example: 'https://bitbonsai.io/pricing',
  })
  @IsUrl()
  cancelUrl: string;
}
