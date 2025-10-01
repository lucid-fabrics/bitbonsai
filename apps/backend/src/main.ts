import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api/v1');
  app.enableCors();

  // Swagger API Documentation Configuration
  const config = new DocumentBuilder()
    .setTitle('MediaInsight API')
    .setDescription('REST API for analyzing video media libraries')
    .setVersion('0.1.0')
    .addTag('media-stats', 'Media library statistics and analytics')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'MediaInsight API Documentation',
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

  const port = process.env['PORT'] || 3000;
  await app.listen(port);
  console.log(`🚀 MediaInsight API running on: http://localhost:${port}/api/v1`);
  console.log(`📚 Swagger API Docs available at: http://localhost:${port}/api/docs`);
}
bootstrap();
