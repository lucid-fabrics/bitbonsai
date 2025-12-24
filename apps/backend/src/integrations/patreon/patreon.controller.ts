import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Logger,
  Post,
  Query,
  RawBodyRequest,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { PatreonService } from './patreon.service';

/**
 * PatreonController
 *
 * Handles Patreon OAuth flow and webhook integration:
 * - GET /patreon/auth - Start OAuth flow (redirects to Patreon)
 * - GET /patreon/callback - OAuth callback (exchanges code for token)
 * - POST /patreon/webhook - Webhook endpoint for pledge events
 * - GET /patreon/status - Check if Patreon is connected
 */
@ApiTags('Patreon')
@Controller('patreon')
export class PatreonController {
  private readonly logger = new Logger(PatreonController.name);

  constructor(private readonly patreonService: PatreonService) {}

  @Get('auth')
  @ApiOperation({
    summary: 'Start Patreon OAuth flow',
    description: 'Redirects user to Patreon authorization page.',
  })
  @ApiQuery({
    name: 'return_url',
    required: false,
    description: 'URL to redirect back to after authorization',
  })
  async startAuth(@Query('return_url') returnUrl: string, @Res() res: Response): Promise<void> {
    if (!this.patreonService.isConfigured()) {
      throw new BadRequestException('Patreon integration is not configured');
    }

    const state = returnUrl ? Buffer.from(returnUrl).toString('base64') : '';
    const authUrl = this.patreonService.getAuthorizationUrl(state);

    this.logger.log('Redirecting to Patreon OAuth');
    res.redirect(authUrl);
  }

  @Get('callback')
  @ApiOperation({
    summary: 'Patreon OAuth callback',
    description: 'Handles the OAuth callback from Patreon and activates the license.',
  })
  @ApiQuery({ name: 'code', required: true, description: 'OAuth authorization code' })
  @ApiQuery({ name: 'state', required: false, description: 'State parameter (return URL)' })
  @ApiResponse({ status: 302, description: 'Redirects to return URL or settings page' })
  async handleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response
  ): Promise<void> {
    // Decode return URL from state
    let returnUrl = '/settings?tab=license';
    if (state) {
      try {
        returnUrl = Buffer.from(state, 'base64').toString('utf-8') || returnUrl;
      } catch {
        // Invalid state, use default
      }
    }

    if (error) {
      this.logger.warn(`Patreon OAuth error: ${error}`);
      res.redirect(`${returnUrl}&patreon=error&message=${encodeURIComponent(error)}`);
      return;
    }

    if (!code) {
      res.redirect(`${returnUrl}&patreon=error&message=no_code`);
      return;
    }

    try {
      // Exchange code for token
      const tokens = await this.patreonService.exchangeCodeForToken(code);

      // Get membership info
      const member = await this.patreonService.getMembershipInfo(tokens.accessToken);

      if (!member) {
        this.logger.warn('No Patreon membership found');
        res.redirect(`${returnUrl}&patreon=error&message=no_membership`);
        return;
      }

      // Activate license
      await this.patreonService.activateLicenseFromPatreon(member);

      this.logger.log(`Patreon OAuth successful for ${member.email}`);
      res.redirect(`${returnUrl}&patreon=success&tier=${member.status}`);
    } catch (err) {
      this.logger.error('Patreon OAuth callback failed', err);
      res.redirect(`${returnUrl}&patreon=error&message=callback_failed`);
    }
  }

  @Post('webhook')
  @ApiOperation({
    summary: 'Patreon webhook endpoint',
    description: 'Receives pledge events from Patreon to update licenses.',
  })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid webhook signature' })
  async handleWebhook(
    @Headers('x-patreon-signature') signature: string,
    @Headers('x-patreon-event') eventType: string,
    @Req() req: RawBodyRequest<Request>,
    @Body() body: unknown
  ): Promise<{ success: boolean }> {
    this.logger.log(`Received Patreon webhook: ${eventType}`);

    if (!signature) {
      throw new BadRequestException('Missing webhook signature');
    }

    const rawBody = req.rawBody?.toString('utf-8') || JSON.stringify(body);

    await this.patreonService.handleWebhook(
      signature,
      body as Parameters<typeof this.patreonService.handleWebhook>[1],
      rawBody
    );

    return { success: true };
  }

  @Get('status')
  @ApiOperation({
    summary: 'Get Patreon integration status',
    description: 'Check if Patreon OAuth is configured and if user is connected.',
  })
  async getStatus(): Promise<{
    configured: boolean;
    connected: boolean;
    authUrl?: string;
  }> {
    const configured = this.patreonService.isConfigured();

    return {
      configured,
      connected: false, // TODO: Check if current user has Patreon connection
      authUrl: configured ? this.patreonService.getAuthorizationUrl() : undefined,
    };
  }
}
