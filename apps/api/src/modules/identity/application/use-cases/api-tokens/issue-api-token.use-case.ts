import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../../shared/application/ports/activity-log.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../../../../shared/application/ports/id-generator.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { ConflictError, ValidationFailedError } from '../../../../../shared/domain/domain-error';
import type { ApiTokenSecretsPort } from '../../ports/api-token-secrets.port';
import type { ApiTokenRepository } from '../../ports/api-token.repository.port';
import {
  API_TOKEN_ERROR_KEYS,
  API_TOKEN_MAX_ACTIVE,
  DAY_MS,
  parseIssueInput,
  toApiTokenOutput,
  type ApiTokenOutput,
} from './api-token-support';

export interface IssueApiTokenInput {
  readonly name: string;
  readonly expiresInDays?: number | undefined;
}

/** The only response that carries the secret; it cannot be read again. */
export interface IssuedApiTokenOutput extends ApiTokenOutput {
  readonly secret: string;
}

/**
 * Issues a personal access token for the caller (A9, DT-189). Own tokens only, so there is no `can()`; the
 * limit of 10 active tokens is checked in the same `Serializable` unit of work as the insert (C18).
 */
export class IssueApiToken {
  constructor(
    private readonly uow: UnitOfWorkPort,
    private readonly tokens: ApiTokenRepository,
    private readonly secrets: ApiTokenSecretsPort,
    private readonly activity: ActivityLogPort,
    private readonly clock: ClockPort,
    private readonly ids: IdGeneratorPort,
  ) {}

  async execute(actor: CurrentUser, input: IssueApiTokenInput): Promise<IssuedApiTokenOutput> {
    const parsed = parseIssueInput(input);
    if (!parsed.ok) throw new ValidationFailedError({ fieldErrors: parsed.fieldErrors });

    return this.uow.run(
      async () => {
        const now = this.clock.now();
        const active = await this.tokens.countActive(actor.userId, now);
        if (active >= API_TOKEN_MAX_ACTIVE) {
          throw new ConflictError({ message: API_TOKEN_ERROR_KEYS.limitReached });
        }
        const generated = this.secrets.generate();
        const row = {
          id: this.ids.next(),
          userId: actor.userId,
          name: parsed.name,
          prefix: generated.prefix,
          tokenHash: generated.hash,
          expiresAt: new Date(now.getTime() + parsed.expiresInDays * DAY_MS),
          revokedAt: null,
          lastUsedAt: null,
          createdAt: now,
        };
        await this.tokens.insert(row);
        await this.activity.record({
          actor: actorOf(actor),
          action: 'CREATE',
          entityType: 'API_TOKEN',
          entityId: row.id,
          entityLabel: row.name,
          metadata: { prefix: row.prefix },
        });
        return { ...toApiTokenOutput(row), secret: generated.secret };
      },
      { isolation: 'Serializable' },
    );
  }
}
