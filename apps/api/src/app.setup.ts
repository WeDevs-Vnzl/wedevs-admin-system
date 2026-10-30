import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import * as Sentry from '@sentry/node';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import type { AppConfig } from './config/env.schema';
import { CorrelationIdMiddleware } from './shared/interface/correlation-id.middleware';
import { restoreNullableTypes } from './shared/interface/openapi-nullable';
import { HttpErrorFilter } from './shared/interface/http-error.filter';
import { RequestContextMiddleware } from './shared/interface/request-context.middleware';
import { AppZodValidationPipe } from './shared/interface/zod-validation';

export const API_PREFIX = 'api';
export const OPENAPI_JSON_PATH = '/api/openapi.json';

/** Builds the OpenAPI 3.1 document of the configured app (routes are scanned, nothing listens). */
export function buildOpenApiDocument(app: NestExpressApplication): OpenAPIObject {
  const options = new DocumentBuilder()
    .setTitle('WeDevs Core API')
    .setDescription('Backend of WeDevs Core. Errors use the ErrorResponse envelope.')
    .setVersion('1')
    .setOpenAPIVersion('3.1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .addSecurityRequirements('bearer')
    .build();
  const document = SwaggerModule.createDocument(app, options);
  return cleanupOpenApiDoc(restoreNullableTypes(document), { version: '3.1' });
}

/**
 * The single bootstrap shared by `main.ts`, the OpenAPI script and e2e: prefix and versioning,
 * correlation id, filter, pipe, CORS, OpenAPI, shutdown hooks and Sentry.
 */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  if (config.SENTRY_DSN) Sentry.init({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV });

  app.disable('x-powered-by');
  app.setGlobalPrefix(API_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Before body parsing and routing, so parse errors and 404s carry the request id.
  const correlation = new CorrelationIdMiddleware();
  app.use((req: Parameters<CorrelationIdMiddleware['use']>[0], res: never, next: never) =>
    correlation.use(req, res, next),
  );

  // Per-request ip and user agent for the activity writer (Q-BE2-5); `req.ip` follows Express' trust-proxy setting.
  const requestContext = app.get(RequestContextMiddleware);
  app.use((req: Parameters<RequestContextMiddleware['use']>[0], res: never, next: never) =>
    requestContext.use(req, res, next),
  );

  app.useGlobalFilters(app.get(HttpErrorFilter));
  app.useGlobalPipes(app.get(AppZodValidationPipe));

  // Only the FE origin gets CORS headers; any other origin receives none (C24, DT-52).
  const allowedOrigin = new URL(config.APP_URL).origin;
  app.enableCors({
    origin: (origin, callback) => callback(null, origin === undefined || origin === allowedOrigin),
    credentials: true,
  });

  if (config.NODE_ENV !== 'production') {
    SwaggerModule.setup(API_PREFIX, app, buildOpenApiDocument(app), {
      jsonDocumentUrl: OPENAPI_JSON_PATH,
      ui: false,
    });
  }

  app.enableShutdownHooks();
}
