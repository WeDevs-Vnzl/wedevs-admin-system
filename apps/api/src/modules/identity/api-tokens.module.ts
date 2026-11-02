import { Module } from '@nestjs/common';
import type { ActivityLogPort } from '../../shared/application/ports/activity-log.port';
import type { ClockPort } from '../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../shared/application/ports/id-generator.port';
import {
  ACTIVITY_LOG,
  CLOCK,
  ID_GENERATOR,
  MCP_AUTHENTICATOR,
  UNIT_OF_WORK,
} from '../../shared/application/ports/tokens';
import type { UnitOfWorkPort } from '../../shared/application/ports/unit-of-work.port';
import {
  API_TOKEN_SECRETS,
  type ApiTokenSecretsPort,
} from './application/ports/api-token-secrets.port';
import {
  API_TOKEN_REPOSITORY,
  type ApiTokenRepository,
} from './application/ports/api-token.repository.port';
import { AuthenticateApiToken } from './application/use-cases/api-tokens/authenticate-api-token.use-case';
import { IssueApiToken } from './application/use-cases/api-tokens/issue-api-token.use-case';
import { ListApiTokens } from './application/use-cases/api-tokens/list-api-tokens.use-case';
import { RevokeApiToken } from './application/use-cases/api-tokens/revoke-api-token.use-case';
import { ApiTokenAuthenticator } from './infrastructure/api-token-authenticator';
import { NodeApiTokenSecrets } from './infrastructure/api-token-authenticator-secrets';
import { PrismaApiTokenRepository } from './infrastructure/prisma-api-token.repository';

/**
 * Identity, personal access tokens (A9, DT-189, DT-190): issue, list and revoke the caller's own tokens, and
 * `MCP_AUTHENTICATOR`, the second authenticator used only on `POST /mcp`. Does not bind the Clerk
 * `AUTHENTICATOR`. Exports the use cases for the token routes (package 3.4) and the authenticator token for
 * the MCP route. Not imported by `AppModule` before package 4.1.
 */
@Module({
  providers: [
    { provide: API_TOKEN_REPOSITORY, useClass: PrismaApiTokenRepository },
    {
      provide: API_TOKEN_SECRETS,
      useFactory: (): ApiTokenSecretsPort => new NodeApiTokenSecrets(),
    },
    {
      provide: IssueApiToken,
      useFactory: (
        uow: UnitOfWorkPort,
        tokens: ApiTokenRepository,
        secrets: ApiTokenSecretsPort,
        activity: ActivityLogPort,
        clock: ClockPort,
        ids: IdGeneratorPort,
      ) => new IssueApiToken(uow, tokens, secrets, activity, clock, ids),
      inject: [
        UNIT_OF_WORK,
        API_TOKEN_REPOSITORY,
        API_TOKEN_SECRETS,
        ACTIVITY_LOG,
        CLOCK,
        ID_GENERATOR,
      ],
    },
    {
      provide: ListApiTokens,
      useFactory: (tokens: ApiTokenRepository) => new ListApiTokens(tokens),
      inject: [API_TOKEN_REPOSITORY],
    },
    {
      provide: RevokeApiToken,
      useFactory: (
        uow: UnitOfWorkPort,
        tokens: ApiTokenRepository,
        activity: ActivityLogPort,
        clock: ClockPort,
      ) => new RevokeApiToken(uow, tokens, activity, clock),
      inject: [UNIT_OF_WORK, API_TOKEN_REPOSITORY, ACTIVITY_LOG, CLOCK],
    },
    {
      provide: AuthenticateApiToken,
      useFactory: (tokens: ApiTokenRepository, secrets: ApiTokenSecretsPort, clock: ClockPort) =>
        new AuthenticateApiToken(tokens, secrets, clock),
      inject: [API_TOKEN_REPOSITORY, API_TOKEN_SECRETS, CLOCK],
    },
    {
      provide: MCP_AUTHENTICATOR,
      useFactory: (authenticate: AuthenticateApiToken) => new ApiTokenAuthenticator(authenticate),
      inject: [AuthenticateApiToken],
    },
  ],
  exports: [IssueApiToken, ListApiTokens, RevokeApiToken, AuthenticateApiToken, MCP_AUTHENTICATOR],
})
export class ApiTokensModule {}
