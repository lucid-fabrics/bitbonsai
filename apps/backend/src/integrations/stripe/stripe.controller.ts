import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { StripeService } from './stripe.service';

/**
 * StripeController
 *
 * Handles Stripe payment integration:
 * - POST /stripe/checkout - Create checkout session
 * - POST /stripe/webhook - Webhook endpoint for payment events
 * - GET /stripe/plans - Get available commercial plans
 * - GET /stripe/status - Check if Stripe is configured
 */
@ApiTags('Stripe')
@Controller('stripe')
export class StripeController {
  constructor(private readonly stripeService: StripeService) {}

  @Post('checkout')
  @ApiOperation({
    summary: 'Create Stripe checkout session',
    description: 'Creates a checkout session for purchasing a commercial license.',
  })
  @ApiResponse({ status: 200, description: 'Checkout session created' })
  async createCheckout(
    @Body() body: { email: string; priceId: string; returnUrl?: string }
  ): Promise<{ sessionId: string; url: string }> {
    if (!this.stripeService.isConfigured()) {
      throw new BadRequestException('Stripe is not configured');
    }

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    const returnUrl = body.returnUrl || `${baseUrl}/settings?tab=license`;

    return this.stripeService.createCheckoutSession({
      email: body.email,
      priceId: body.priceId,
      successUrl: `${returnUrl}&stripe=success`,
      cancelUrl: `${returnUrl}&stripe=cancelled`,
    });
  }

  @Post('webhook')
  @ApiOperation({
    summary: 'Stripe webhook endpoint',
    description: 'Receives payment events from Stripe to update licenses.',
  })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: RawBodyRequest<Request>
  ): Promise<{ received: boolean }> {
    if (!signature) {
      throw new BadRequestException('Missing Stripe signature');
    }

    if (!req.rawBody) {
      throw new BadRequestException('Missing raw body');
    }

    await this.stripeService.handleWebhook(signature, req.rawBody);

    return { received: true };
  }

  @Get('plans')
  @ApiOperation({
    summary: 'Get available commercial plans',
    description: 'Returns all available commercial license plans with pricing.',
  })
  async getPlans() {
    if (!this.stripeService.isConfigured()) {
      return { plans: [], configured: false };
    }

    const plans = await this.stripeService.getPlans();
    return { plans, configured: true };
  }

  @Get('status')
  @ApiOperation({
    summary: 'Get Stripe integration status',
    description: 'Check if Stripe is configured.',
  })
  async getStatus(): Promise<{ configured: boolean }> {
    return {
      configured: this.stripeService.isConfigured(),
    };
  }

  @Post('portal')
  @ApiOperation({
    summary: 'Get customer portal URL',
    description: 'Get URL to Stripe customer portal for managing subscription.',
  })
  async getPortalUrl(
    @Body() body: { customerId: string; returnUrl?: string }
  ): Promise<{ url: string }> {
    if (!this.stripeService.isConfigured()) {
      throw new BadRequestException('Stripe is not configured');
    }

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    const returnUrl = body.returnUrl || `${baseUrl}/settings?tab=license`;

    const url = await this.stripeService.getCustomerPortalUrl(body.customerId, returnUrl);

    return { url };
  }
}
