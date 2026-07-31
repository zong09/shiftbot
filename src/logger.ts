import * as winston from 'winston';
import { utilities as nestWinstonUtilities } from 'nest-winston';
import 'winston-daily-rotate-file';

const SECRET_KEY = /token|secret|password|authorization|api[-_]?key/i;

// Axios hangs the full request config off every error, and the Telegram bot token lives
// in the URL path (`/bot<token>/sendMessage`) — serializing one of these errors would
// write the token into logs/ for the 30-day retention window. Nothing does that today;
// this makes sure nothing can start doing it by accident either.
const AXIOS_NOISE = new Set(['config', 'request', 'response']);

function redactValue(value: unknown, depth: number): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (AXIOS_NOISE.has(key) && val && typeof val === 'object') continue;
    out[key] = SECRET_KEY.test(key) ? '[REDACTED]' : redactValue(val, depth + 1);
  }
  return out;
}

/**
 * Scrub credentials before anything reaches disk. Applies to the file transports only —
 * the console transport is the developer's own terminal, and stripping values there
 * would only make local debugging harder.
 */
export const redactSecrets = winston.format(
  (info) => redactValue(info, 0) as winston.Logform.TransformableInfo,
);

const jsonFormat = winston.format.combine(
  redactSecrets(),
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
