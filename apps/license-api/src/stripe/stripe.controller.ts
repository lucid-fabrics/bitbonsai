import { BadRequestException, Body, Controller, Logger, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { StripeService } from './stripe.service';

@ApiTags('stripe')
@Controller('stripe')
@UseGuards(ThrottlerGuard)
export class StripeController {
  private readonly logger = new Logger(StripeController.name);

  constructor(private readonly stripeService: StripeService) {}

  @Public()
  @Post('checkout')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 requests per minute
  @ApiOperation({ summary: 'Create Stripe checkout session for subscription' })
  async createCheckoutSession(@Body() dto: CreateCheckoutDto) {
    try {
      const result = await this.stripeService.createCheckoutSession(dto);
      this.logger.log(`Created checkout session for ${dto.email}`);
      return result;
    } catch (error) {
      this.logger.error('Failed to create checkout session', error);
      throw new BadRequestException('Failed to create checkout session');
    }
  }
}
