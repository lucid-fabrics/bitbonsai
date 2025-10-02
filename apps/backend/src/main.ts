import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { WinstonModule } from 'nest-winston';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters';
import { winstonConfig } from './common/logging';

async function bootstrap() {
  // Create app with Winston logger
  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger(winstonConfig),
  });

  app.setGlobalPrefix('api/v1');
  app.enableCors();
  app.enableShutdownHooks();

  // CRITICAL: Global exception filter for consistent error handling
  app.useGlobalFilters(new GlobalExceptionFilter());

  // CRITICAL: Global validation pipe to validate all DTOs
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
