import type { ApiTokenOwner } from '../../../src/modules/identity/application/ports/api-token.repository.port';
import { IssueApiToken } from '../../../src/modules/identity/application/use-cases/api-tokens/issue-api-token.use-case';
import { ListApiTokens } from '../../../src/modules/identity/application/use-cases/api-tokens/list-api-tokens.use-case';
import { RevokeApiToken } from '../../../src/modules/identity/application/use-cases/api-tokens/revoke-api-token.use-case';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { InMemoryActivityLog } from '../../support/fakes/in-memory-activity-log';
import { InMemoryApiTokenRepository } from '../../support/fakes/in-memory-api-token.repository';
import { InMemoryApiTokenSecrets } from '../../support/fakes/in-memory-api-token-secrets';
import { InMemoryUnitOfWork } from '../../support/fakes/in-memory-unit-of-work';
import { SequentialIdGenerator } from '../../support/fakes/sequential-id-generator';

export function createTokenWorld() {
  const clock = new FixedClock();
  const uow = new InMemoryUnitOfWork();
  const activity = new InMemoryActivityLog(uow);
  const tokens = new InMemoryApiTokenRepository();
  const secrets = new InMemoryApiTokenSecrets();
  const ids = new SequentialIdGenerator('tok');
  return {
    clock,
    uow,
    activity,
    tokens,
    secrets,
    issue: new IssueApiToken(uow, tokens, secrets, activity, clock, ids),
    list: new ListApiTokens(tokens),
    revoke: new RevokeApiToken(uow, tokens, activity, clock),
  };
}
export type TokenWorld = ReturnType<typeof createTokenWorld>;

export function seedOwner(
  world: TokenWorld,
  overrides: Partial<ApiTokenOwner> = {},
): { owner: ApiTokenOwner; actor: CurrentUser } {
  const owner: ApiTokenOwner = {
    id: 'usr_1',
    clerkId: 'clerk_1',
    role: 'ADMIN',
    email: 'one@example.com',
    name: 'User One',
    deletedAt: null,
    ...overrides,
  };
  world.tokens.seedOwner(owner);
  return {
    owner,
    actor: {
      userId: owner.id,
      clerkId: owner.clerkId,
      role: owner.role,
      email: owner.email,
      name: owner.name,
    },
  };
}
