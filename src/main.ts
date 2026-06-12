import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import { AppModule } from './app.module';
import { createWinstonLogger } from './logger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger(createWinstonLogger()),
  });
  app.enableCors();

  const port = process.env.PORT || 3000;
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`🤖 CDC Trading Bot กำลังทำงาน → http://localhost:${port}`);
  logger.log(`📊 Dashboard: http://localhost:5173`);
}

bootstrap();
