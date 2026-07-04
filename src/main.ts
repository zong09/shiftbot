import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { WinstonModule } from "nest-winston";
import { AppModule } from "./app.module";
import { createWinstonLogger } from "./logger";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger(createWinstonLogger()),
  });
  // Restrict CORS to the dashboard origin(s) when DASHBOARD_ORIGIN is set;
  // stay permissive in local dev where the Vite proxy handles same-origin.
  app.enableCors({
    origin: process.env.DASHBOARD_ORIGIN ? process.env.DASHBOARD_ORIGIN.split(',') : true,
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');

  const logger = new Logger("Bootstrap");
  logger.log(`🤖 CDC Trading Bot กำลังทำงาน → http://localhost:${port}`);
  logger.log(`📊 Dashboard: http://localhost:5173`);
}

bootstrap();
