import { Module } from '@nestjs/common';
import { AUTHORIZATION } from '../../shared/application/ports/tokens';
import { MatrixAuthorization } from './application/matrix-authorization';

/**
 * Binds and exports `AUTHORIZATION` only: the pure PRD §4.3 permission matrix, with no Clerk and no I/O.
 * Shared by `IdentityModule` (API) and the worker's `JobsModule`, so the worker never imports the identity
 * infrastructure (DT-181 5a).
 */
@Module({
  providers: [{ provide: AUTHORIZATION, useFactory: () => new MatrixAuthorization() }],
  exports: [AUTHORIZATION],
})
export class AuthorizationModule {}
