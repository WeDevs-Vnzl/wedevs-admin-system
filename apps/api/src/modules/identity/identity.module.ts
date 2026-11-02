import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env.schema';
import type { ActivityLogPort } from '../../shared/application/ports/activity-log.port';
import type { AuthorizationPort } from '../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../shared/application/ports/id-generator.port';
import {
  ACTIVITY_LOG,
  AUTHENTICATOR,
  AUTHORIZATION,
  CLOCK,
  ID_GENERATOR,
  UNIT_OF_WORK,
} from '../../shared/application/ports/tokens';
import type { UnitOfWorkPort } from '../../shared/application/ports/unit-of-work.port';
import { APP_LOGGER, type AppLogger } from '../../shared/interface/logger';
import { SharedInterfaceModule } from '../../shared/interface/shared-interface.module';
import { DIAGNOSTICS_TOKEN, type DiagnosticsPort } from './application/ports/diagnostics.port';
import {
  IDENTITY_PROVIDER,
  type IdentityProviderPort,
} from './application/ports/identity-provider.port';
import {
  LOGIN_ACTIVITY_REPOSITORY,
  type LoginActivityRepository,
} from './application/ports/login-activity.repository.port';
import {
  USER_PREFERENCE_REPOSITORY,
  type UserPreferenceRepository,
} from './application/ports/user-preference.repository.port';
import { USER_REPOSITORY, type UserRepository } from './application/ports/user.repository.port';
import {
  WEBHOOK_VERIFIER,
  type WebhookVerifierPort,
} from './application/ports/webhook-verifier.port';
import { AuthenticateRequest } from './application/use-cases/authenticate-request.use-case';
import { ChangeUserRole } from './application/use-cases/change-user-role.use-case';
import { GetCurrentUser } from './application/use-cases/get-current-user.use-case';
import { GetPreferences } from './application/use-cases/get-preferences.use-case';
import { GetUser } from './application/use-cases/get-user.use-case';
import { HandleClerkWebhook } from './application/use-cases/handle-clerk-webhook.use-case';
import { InviteUser } from './application/use-cases/invite-user.use-case';
import { ListInvitations } from './application/use-cases/list-invitations.use-case';
import { ListUsers } from './application/use-cases/list-users.use-case';
import { RecordLogin } from './application/use-cases/record-login.use-case';
import { ResetPreference } from './application/use-cases/reset-preference.use-case';
import { RevokeInvitation } from './application/use-cases/revoke-invitation.use-case';
import { SetPreference } from './application/use-cases/set-preference.use-case';
import { SyncClerkUser } from './application/use-cases/sync-clerk-user.use-case';
import { MatrixAuthorization } from './application/matrix-authorization';
import { ClerkIdentityProvider } from './infrastructure/clerk-identity-provider';
import { PrismaLoginActivityRepository } from './infrastructure/prisma-login-activity.repository';
import { PrismaUserPreferenceRepository } from './infrastructure/prisma-user-preference.repository';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository';
import { SvixWebhookVerifier } from './infrastructure/svix-webhook-verifier';
import { ClerkWebhookController } from './interface/http/clerk-webhook.controller';
import { MeController } from './interface/http/me.controller';
import { UsersController } from './interface/http/users.controller';

/**
 * Identity: Clerk authentication, the permission matrix, users and invitations, the Clerk webhook and
 * preferences. `@Global()` because the global `AuthGuard` resolves `AUTHENTICATOR` and `AUTHORIZATION`
 * from the app scope; it is the only place those tokens are bound (wired into `AppModule` by package 3.1).
 */
@Global()
@Module({
  imports: [SharedInterfaceModule],
  controllers: [MeController, UsersController, ClerkWebhookController],
  providers: [
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: USER_PREFERENCE_REPOSITORY, useClass: PrismaUserPreferenceRepository },
    { provide: LOGIN_ACTIVITY_REPOSITORY, useClass: PrismaLoginActivityRepository },
    {
      provide: IDENTITY_PROVIDER,
      useFactory: (config: AppConfig) =>
        new ClerkIdentityProvider({
          secretKey: config.CLERK_SECRET_KEY,
          jwtKey: config.CLERK_JWT_KEY,
          appUrl: config.APP_URL,
        }),
      inject: [APP_CONFIG],
    },
    {
      provide: WEBHOOK_VERIFIER,
      useFactory: (config: AppConfig) => new SvixWebhookVerifier(config.CLERK_WEBHOOK_SECRET),
      inject: [APP_CONFIG],
    },
    {
      provide: DIAGNOSTICS_TOKEN,
      useFactory: (logger: AppLogger): DiagnosticsPort => ({
        warn: (message, context) => logger.warn(context, message),
      }),
      inject: [APP_LOGGER],
    },
    { provide: AUTHORIZATION, useFactory: () => new MatrixAuthorization() },
    {
      provide: AUTHENTICATOR,
      useFactory: (identity: IdentityProviderPort, users: UserRepository) =>
        new AuthenticateRequest(identity, users),
      inject: [IDENTITY_PROVIDER, USER_REPOSITORY],
    },
    {
      provide: GetCurrentUser,
      useFactory: (users: UserRepository) => new GetCurrentUser(users),
      inject: [USER_REPOSITORY],
    },
    {
      provide: ListUsers,
      useFactory: (authz: AuthorizationPort, users: UserRepository) => new ListUsers(authz, users),
      inject: [AUTHORIZATION, USER_REPOSITORY],
    },
    {
      provide: GetUser,
      useFactory: (authz: AuthorizationPort, users: UserRepository) => new GetUser(authz, users),
      inject: [AUTHORIZATION, USER_REPOSITORY],
    },
    {
      provide: ChangeUserRole,
      useFactory: (
        authz: AuthorizationPort,
        users: UserRepository,
        uow: UnitOfWorkPort,
        activity: ActivityLogPort,
        clock: ClockPort,
        identity: IdentityProviderPort,
        diagnostics: DiagnosticsPort,
      ) => new ChangeUserRole(authz, users, uow, activity, clock, identity, diagnostics),
      inject: [
        AUTHORIZATION,
        USER_REPOSITORY,
        UNIT_OF_WORK,
        ACTIVITY_LOG,
        CLOCK,
        IDENTITY_PROVIDER,
        DIAGNOSTICS_TOKEN,
      ],
    },
    {
      provide: ListInvitations,
      useFactory: (authz: AuthorizationPort, identity: IdentityProviderPort) =>
        new ListInvitations(authz, identity),
      inject: [AUTHORIZATION, IDENTITY_PROVIDER],
    },
    {
      provide: InviteUser,
      useFactory: (
        authz: AuthorizationPort,
        users: UserRepository,
        identity: IdentityProviderPort,
        uow: UnitOfWorkPort,
        activity: ActivityLogPort,
        diagnostics: DiagnosticsPort,
      ) => new InviteUser(authz, users, identity, uow, activity, diagnostics),
      inject: [
        AUTHORIZATION,
        USER_REPOSITORY,
        IDENTITY_PROVIDER,
        UNIT_OF_WORK,
        ACTIVITY_LOG,
        DIAGNOSTICS_TOKEN,
      ],
    },
    {
      provide: RevokeInvitation,
      useFactory: (
        authz: AuthorizationPort,
        identity: IdentityProviderPort,
        uow: UnitOfWorkPort,
        activity: ActivityLogPort,
      ) => new RevokeInvitation(authz, identity, uow, activity),
      inject: [AUTHORIZATION, IDENTITY_PROVIDER, UNIT_OF_WORK, ACTIVITY_LOG],
    },
    {
      provide: SyncClerkUser,
      useFactory: (
        users: UserRepository,
        uow: UnitOfWorkPort,
        activity: ActivityLogPort,
        clock: ClockPort,
        ids: IdGeneratorPort,
      ) => new SyncClerkUser(users, uow, activity, clock, ids),
      inject: [USER_REPOSITORY, UNIT_OF_WORK, ACTIVITY_LOG, CLOCK, ID_GENERATOR],
    },
    {
      provide: RecordLogin,
      useFactory: (
        users: UserRepository,
        logins: LoginActivityRepository,
        uow: UnitOfWorkPort,
        activity: ActivityLogPort,
      ) => new RecordLogin(users, logins, uow, activity),
      inject: [USER_REPOSITORY, LOGIN_ACTIVITY_REPOSITORY, UNIT_OF_WORK, ACTIVITY_LOG],
    },
    {
      provide: HandleClerkWebhook,
      useFactory: (verifier: WebhookVerifierPort, sync: SyncClerkUser, login: RecordLogin) =>
        new HandleClerkWebhook(verifier, sync, login),
      inject: [WEBHOOK_VERIFIER, SyncClerkUser, RecordLogin],
    },
    {
      provide: GetPreferences,
      useFactory: (users: UserRepository, prefs: UserPreferenceRepository) =>
        new GetPreferences(users, prefs),
      inject: [USER_REPOSITORY, USER_PREFERENCE_REPOSITORY],
    },
    {
      provide: SetPreference,
      useFactory: (users: UserRepository, prefs: UserPreferenceRepository) =>
        new SetPreference(users, prefs),
      inject: [USER_REPOSITORY, USER_PREFERENCE_REPOSITORY],
    },
    {
      provide: ResetPreference,
      useFactory: (users: UserRepository, prefs: UserPreferenceRepository) =>
        new ResetPreference(users, prefs),
      inject: [USER_REPOSITORY, USER_PREFERENCE_REPOSITORY],
    },
  ],
  exports: [AUTHENTICATOR, AUTHORIZATION],
})
export class IdentityModule {}
