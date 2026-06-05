import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  const port = process.env.PORT || 3000;
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`🤖 CDC Trading Bot กำลังทำงาน → http://localhost:${port}`);
  logger.log(`📊 Dashboard: http://localhost:5173`);
}

bootstrap();
