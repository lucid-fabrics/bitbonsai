import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { WinstonModule } from 'nest-winston';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters';
import { winstonConfig } from './common/logging';

async function bootstrap() {
  // Handle BigInt serialization for JSON responses
  // biome-ignore lint/suspicious/noExplicitAny: BigInt.prototype.toJSON is not typed
  (BigInt.prototype as any).toJSON = function () {
    return this.toString();
  };

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
          styleSrc: ["'self'", "'unsafe-inline'"], // Required for Angular
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false, // Required for some video playback scenarios
      hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true,
      },
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

  app.setGlobalPrefix('api/v1');

  // SECURITY: CORS with validation logic instead of static whitelist
  // Validates origins against environment variable patterns
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

      // Get allowed origins from environment (comma-separated)
      const allowedOrigins = [
        'http://localhost:4200', // Development frontend (default)
        'http://localhost:4201', // Development frontend (HMR)
        process.env.FRONTEND_URL,
        ...(process.env.ALLOWED_ORIGINS?.split(',') || []),
      ].filter(Boolean) as string[];

      // Check if origin is in whitelist
      const isAllowed = allowedOrigins.some((allowedOrigin: string) => {
        // Support wildcard patterns (e.g., https://*.bitbonsai.com)
        if (allowedOrigin.includes('*')) {
          const regex = new RegExp('^' + allowedOrigin.replace(/\*/g, '.*') + '$');
          return regex.test(origin);
        }
        return origin === allowedOrigin;
      });

      if (isAllowed) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
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
      whitelist: true, // Strip properties that don't have decorators
      forbidNonWhitelisted: true, // Throw error if non-whitelisted properties are present
      transform: true, // Automatically transform payloads to DTO instances
      transformOptions: {
        enableImplicitConversion: true, // Convert primitive types automatically
      },
    })
  );

  // Swagger API Documentation Configuration
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

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 BitBonsai API running on: http://0.0.0.0:${port}/api/v1`);
  console.log(`📚 Swagger API Docs available at: http://0.0.0.0:${port}/api/docs`);
}

bootstrap().catch((err) => {
  console.error('Failed to start application:', err);
  process.exit(1);
});
