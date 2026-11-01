import type { CurrentUser } from '../../../../../shared/application/current-user';
import type { AuthorizationPort } from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import { assertMarkReadKeys } from '../../../domain/alert-state';
import type { AlertStateRepository } from '../../ports/alert-state.repository.port';
import { assertKeyVisible } from './alert-support';

export interface MarkAlertsReadInput {
  /** One to 200 keys. */
  readonly alertKeys: readonly string[];
}

/**
 * `POST /alerts/read` and `POST /alerts/{key}/read`: marks the caller's alerts read (idempotent). A read
 * alert stays listed and only leaves the unread counter. Per-user state writes no activity (DT-79).
 */
export class MarkAlertsRead {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly states: AlertStateRepository,
    private readonly clock: ClockPort,
  ) {}

  async execute(user: CurrentUser, input: MarkAlertsReadInput): Promise<{ alertKeys: string[] }> {
    const alertKeys = assertMarkReadKeys(input.alertKeys);
    for (const key of alertKeys) assertKeyVisible(this.authorization, user, key);
    await this.states.markRead(user.userId, alertKeys, this.clock.now());
    return { alertKeys };
  }
}
