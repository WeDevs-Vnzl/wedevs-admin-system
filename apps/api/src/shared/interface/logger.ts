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

/** The share token is a bearer secret (A2): the path segment after `/portal/` never reaches a log line. */
const PORTAL_SEGMENT = /(\/portal\/)[^/?#\s]+/g;
const URL_KEYS = ['url', 'originalUrl'] as const;

function maskUrls(target: Record<string, unknown>): Record<string, unknown> {
  const out = { ...target };
  for (const key of URL_KEYS) {
    const value = out[key];
    if (typeof value === 'string') out[key] = maskPortalToken(value);
  }
  return out;
}

/** Masks the share token in a request path or URL. */
export function maskPortalToken(url: string): string {
  return url.replace(PORTAL_SEGMENT, `$1${REDACTED}`);
}

function maskLogObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out = maskUrls(obj);
  const req = out['req'];
  if (req !== null && typeof req === 'object')
    out['req'] = maskUrls(req as Record<string, unknown>);
  return out;
}

export interface CreateLoggerOptions {
  readonly level?: string;
  readonly destination?: DestinationStream;
}

/** Structured JSON logger that redacts `authorization`, `cookie` and `set-cookie` and masks the share token in URLs. */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  return pino(
    {
      level: options.level ?? 'info',
      redact: { paths: [...REDACT_PATHS], censor: REDACTED },
      formatters: { log: maskLogObject },
    },
    options.destination,
  );
}
