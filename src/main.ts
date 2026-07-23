import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { WinstonModule } from "nest-winston";
import { AppModule } from "./app.module";
import { createWinstonLogger } from "./logger";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger(createWinstonLogger()),
  });
  // Restrict CORS to the dashboard origin(s) when DASHBOARD_ORIGIN is set. In dev
  // stay permissive (the Vite proxy handles same-origin); in production fail closed
  // — the bundled dashboard is served same-origin by ServeStaticModule, so an unset
  // allowlist disabling cross-origin requests does not break the UI.
  const isProd = process.env.NODE_ENV === 'production';
  const corsOrigins = process.env.DASHBOARD_ORIGIN?.split(',');
  app.enableCors({ origin: corsOrigins ?? (isProd ? false : true) });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');

  const logger = new Logger("Bootstrap");
  if (isProd && !corsOrigins) {
    logger.warn('CORS: DASHBOARD_ORIGIN ไม่ได้ตั้ง — cross-origin requests ถูกปิดใน production (ตั้ง DASHBOARD_ORIGIN เพื่ออนุญาต)');
  }
  logger.log(`🤖 CDC Trading Bot กำลังทำงาน → http://localhost:${port}`);
  logger.log(`📊 Dashboard: http://localhost:5173`);
}

bootstrap();
