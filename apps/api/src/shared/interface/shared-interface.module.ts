import { Module } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { CorrelationIdMiddleware } from './correlation-id.middleware';
import { HttpErrorFilter } from './http-error.filter';
import { APP_LOGGER, createLogger } from './logger';
import { RequestContextMiddleware } from './request-context.middleware';
import { AppZodValidationPipe } from './zod-validation';

/**
 * Exports the global filter, pipe, correlation and request-context middleware, logger and `AuthGuard`.
 * Registration (`useGlobalFilters`, `useGlobalPipes`, middleware) happens in `configureApp`.
 */
@Module({
  providers: [
    { provide: APP_LOGGER, useFactory: () => createLogger() },
    HttpErrorFilter,
    AppZodValidationPipe,
    CorrelationIdMiddleware,
    RequestContextMiddleware,
    AuthGuard,
  ],
  exports: [
    APP_LOGGER,
    HttpErrorFilter,
    AppZodValidationPipe,
    CorrelationIdMiddleware,
    RequestContextMiddleware,
    AuthGuard,
  ],
})
export class SharedInterfaceModule {}
