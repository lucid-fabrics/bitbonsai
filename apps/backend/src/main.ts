import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api/v1');
  app.enableCors();

  await app.listen(3000);
  console.log(`🚀 MediaInsight API running on: http://localhost:3000/api/v1`);
}
bootstrap();
