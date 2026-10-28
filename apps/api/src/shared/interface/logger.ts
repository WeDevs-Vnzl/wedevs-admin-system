import pino, { type DestinationStream, type Logger } from 'pino';

/** Injection token of the application logger. */
export const APP_LOGGER = Symbol('APP_LOGGER');

/** Minimal logging surface the interface layer depends on (a pino `Logger` satisfies it). */
export interface AppLogger {
  error(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
}

export const REDACTED = '[Redacted]';

/** Sensitive headers are never logged (C5), at the root and under `req`/`res`. */
export const REDACT_PATHS: readonly string[] = [
  'headers.authorization',
  'headers.cookie',
  'headers["set-cookie"]',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  '*.headers.authorization',
  '*.headers.cookie',
  '*.headers["set-cookie"]',
];

export interface CreateLoggerOptions {
  readonly level?: string;
  readonly destination?: DestinationStream;
}

/** Structured JSON logger that redacts `authorization`, `cookie` and `set-cookie`. */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  return pino(
    {
      level: options.level ?? 'info',
      redact: { paths: [...REDACT_PATHS], censor: REDACTED },
    },
    options.destination,
  );
}
