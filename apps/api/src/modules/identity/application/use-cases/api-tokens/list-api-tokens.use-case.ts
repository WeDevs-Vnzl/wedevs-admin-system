import type { CurrentUser } from '../../../../../shared/application/current-user';
import type { ApiTokenRepository } from '../../ports/api-token.repository.port';
import { toApiTokenOutput, type ApiTokenOutput } from './api-token-support';

/** The caller's own tokens, newest first. Never the secret or the hash. */
export class ListApiTokens {
  constructor(private readonly tokens: ApiTokenRepository) {}

  async execute(actor: CurrentUser): Promise<ApiTokenOutput[]> {
    const rows = await this.tokens.listByUser(actor.userId);
    return rows.map(toApiTokenOutput);
  }
}
