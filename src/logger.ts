import * as winston from 'winston';
import { utilities as nestWinstonUtilities } from 'nest-winston';
import 'winston-daily-rotate-file';

const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json(),
);

export function createWinstonLogger() {
  return {
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp(),
          nestWinstonUtilities.format.nestLike('ShiftBot', { prettyPrint: true }),
        ),
      }),
      new (winston.transports as any).DailyRotateFile({
        filename: 'logs/app-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxFiles: '30d',
        format: jsonFormat,
      }),
      new (winston.transports as any).DailyRotateFile({
        filename: 'logs/error-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxFiles: '30d',
        format: jsonFormat,
      }),
    ],
  };
}
