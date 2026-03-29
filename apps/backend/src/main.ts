import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import * as fs from 'fs';
import helmet from 'helmet';
import { WinstonModule } from 'nest-winston';
import { join } from 'path';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters';
import { winstonConfig } from './common/logging';
import { setupBigIntSerialization } from './common/utils/bigint-serializer';

async function bootstrap() {
  // Handle BigInt serialization for JSON responses
  setupBigIntSerialization();

  // SECURITY: JWT_SECRET validation and auto-generation
  // Generate JWT secret if missing (first-time setup)
  if (!process.env.JWT_SECRET) {
    // Production: require explicit JWT_SECRET
    if (process.env.NODE_ENV === 'production') {
      Logger.error(
        'JWT_SECRET not set in production! Set JWT_SECRET environment variable.',
        'Bootstrap'
      );
      Logger.error('Generate one with: openssl rand -base64 32', 'Bootstrap');
      throw new Error('JWT_SECRET is required in production mode');
    }

    // Development: auto-generate and save to .env
    const secret = crypto.randomBytes(32).toString('base64');
    const envPath = join(process.cwd(), '.env');

    try {
      fs.appendFileSync(
        envPath,
        `\n# Auto-generated JWT secret (${new Date().toISOString()})\nJWT_SECRET=${secret}\n`
      );
      process.env.JWT_SECRET = secret;
      Logger.warn(
        `⚠️  Generated new JWT_SECRET and saved to .env: ${secret.substring(0, 8)}...`,
        'Bootstrap'
      );
      Logger.warn(
        '⚠️  For production, ensure .env is properly secured and not committed to git',
        'Bootstrap'
      );
    } catch {
      Logger.error(
        'Failed to save JWT_SECRET to .env file. Set JWT_SECRET environment variable manually.',
        'Bootstrap'
      );
      throw new Error(`JWT_SECRET must be set. Generate one with: openssl rand -base64 32`);
    }
  }

  // Validate JWT_SECRET length
  if (process.env.JWT_SECRET.length < 32) {
    throw new Error(
      'JWT_SECRET must be at least 32 characters. Generate a new one with: openssl rand -base64 32'
    );
  }

  // Create app with Winston logger
  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger(winstonConfig),
  });

  // SECURITY: Request size limits to prevent DoS attacks
  // Limits both JSON payloads and overall request size
  app.use(require('express').json({ limit: '1mb' })); // JSON payload limit
  app.use(require('express').urlencoded({ extended: true, limit: '10mb' })); // URL-encoded data limit

  // SECURITY: Helmet - security headers middleware
  // Sets various HTTP headers to protect against common vulnerabilities
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'], // Allow Font Awesome
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'", 'http://*:3100', 'ws://*:3000'], // Allow backend API and WebSocket connections
          fontSrc: ["'self'", 'https://cdnjs.cloudflare.com'], // Allow Font Awesome fonts
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
          // Don't upgrade HTTP to HTTPS when not using SSL
          upgradeInsecureRequests: null,
        },
      },
      crossOriginEmbedderPolicy: false, // Required for some video playback scenarios
      hsts: false, // Disable HSTS when not using HTTPS
      frameguard: {
        action: 'deny', // Prevent clickjacking
      },
      hidePoweredBy: true, // Remove X-Powered-By header
      noSniff: true, // X-Content-Type-Options: nosniff
      referrerPolicy: {
        policy: 'strict-origin-when-cross-origin',
      },
    })
  );

  // Serve static frontend files from production build
  const express = require('express');
  // __dirname is dist/apps/backend, so we need ../frontend
  const frontendPath = join(__dirname, '../frontend');

  // Serve static files (JS, CSS, images)
  app.use(
    express.static(frontendPath, {
      index: false, // Don't auto-serve index.html for directories
      maxAge: '1y', // Cache static assets for 1 year
      setHeaders: (res: Response, filePath: string) => {
        // Don't cache index.html
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
      },
    })
  );

  app.setGlobalPrefix('api/v1');

  // SECURITY: CORS with explicit origin validation
  // For production on-premise deployments, use ALLOWED_ORIGINS environment variable
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void
    ) => {
      // Allow requests with no origin (mobile apps, curl, Postman)
      if (!origin) {
        callback(null, true);
        return;
      }

      // Parse URL to extract hostname and port
      let originUrl: URL;
      try {
        originUrl = new URL(origin);
      } catch {
        callback(new Error(`Invalid origin: ${origin}`));
        return;
      }

      // Base allowed origins (explicit only)
      const explicitOrigins = [
        'http://localhost:4200', // Development frontend (default)
        'http://localhost:4201', // Development frontend (HMR)
        'http://localhost:3000', // LXC frontend on port 3000
        process.env.FRONTEND_URL,
        ...(process.env.ALLOWED_ORIGINS?.split(',') || []),
      ].filter(Boolean) as string[];

      // Check explicit origins first
      if (explicitOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      // For on-premise deployments: Allow private IP ranges on specific ports
      // This replaces the wildcard patterns with explicit subnet validation
      const hostname = originUrl.hostname;
      const port = originUrl.port;
      const isPrivateIP =
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('10.') ||
        hostname.startsWith('172.16.') ||
        hostname.startsWith('172.17.') ||
        hostname.startsWith('172.18.') ||
        hostname.startsWith('172.19.') ||
        hostname.startsWith('172.2') ||
        hostname.startsWith('172.30.') ||
        hostname.startsWith('172.31.');

      // Allow private IPs on specific ports (on-premise deployments)
      const allowedPorts = ['3000', '3100', '4200', '4210', '8108'];
      if (isPrivateIP && allowedPorts.includes(port)) {
        callback(null, true);
        return;
      }

      // Origin not in allowlist
      Logger.warn(`CORS blocked origin: ${origin}`, 'Bootstrap');
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['X-Total-Count'],
    maxAge: 86400, // 24 hours preflight cache
  });

  app.enableShutdownHooks();

  // CRITICAL: Global exception filter for consistent error handling
  // biome-ignore lint/correctness/useHookAtTopLevel: NestJS method, not a React hook
  app.useGlobalFilters(new GlobalExceptionFilter());

  // CRITICAL: Global validation pipe to validate all DTOs
  // biome-ignore lint/correctness/useHookAtTopLevel: NestJS method, not a React hook
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: false, // MULTI-NODE: Allow extra properties for job proxying
      forbidNonWhitelisted: false, // MULTI-NODE: Don't reject unknown properties
      transform: true, // Automatically transform payloads to DTO instances
      transformOptions: {
        enableImplicitConversion: true, // Convert primitive types automatically
      },
    })
  );

  // Swagger API Documentation Configuration
  // Available at /api/docs for on-premise administrators
  // Protected by JWT authentication for sensitive endpoints
  const config = new DocumentBuilder()
    .setTitle('BitBonsai API')
    .setDescription('REST API for analyzing video media libraries')
    .setVersion('0.1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth'
    )
    .addTag('Authentication', 'User authentication and JWT token management')
    .addTag('health', 'Health check and monitoring endpoints')
    .addTag('overview', 'Dashboard overview with aggregated metrics')
    .addTag('nodes', 'Node registration, pairing, and cluster management')
    .addTag('media-stats', 'Media library statistics and analytics')
    .addTag('libraries', 'Media library CRUD operations')
    .addTag('licenses', 'License validation and management')
    .addTag('settings', 'System settings and environment detection')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'BitBonsai API Documentation',
    customfavIcon: '/favicon.ico',
    customCss: '.swagger-ui .topbar { display: none }',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      showExtensions: true,
      showCommonExtensions: true,
    },
  });
  Logger.log('📚 Swagger API documentation available at /api/docs', 'Bootstrap');

  // Catch-all route to serve index.html for Angular routing
  // Must be AFTER all API routes and Swagger setup
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Skip if this is an API or Swagger route
    if (req.originalUrl.startsWith('/api')) {
      next();
      return;
    }
    // Serve index.html for all other routes (Angular routing)
    res.sendFile(join(frontendPath, 'index.html'));
  });

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  const logger = new Logger('Bootstrap');
  logger.log(`🚀 BitBonsai API running on: http://0.0.0.0:${port}/api/v1`);
  logger.log(`📚 Swagger API Docs available at: http://0.0.0.0:${port}/api/docs`);
  logger.log(`🌐 Frontend available at: http://0.0.0.0:${port}/`);
}

const logger = new Logger('Bootstrap');
bootstrap().catch((err) => {
  logger.error('Failed to start application:', err);
  process.exit(1);
});
