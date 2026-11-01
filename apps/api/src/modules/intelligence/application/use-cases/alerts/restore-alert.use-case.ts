import type { CurrentUser } from '../../../../../shared/application/current-user';
import type { AuthorizationPort } from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import { toDismissalView, type AlertDismissalView } from '../../../domain/alert-state';
import type { AlertStateRepository } from '../../ports/alert-state.repository.port';
import { assertKeyVisible } from './alert-support';

/** `POST /alerts/{key}/restore`: clears both hiding columns and keeps `readAt`. Own row, no activity. */
export class RestoreAlert {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly states: AlertStateRepository,
    private readonly clock: ClockPort,
  ) {}

  async execute(user: CurrentUser, input: { alertKey: string }): Promise<AlertDismissalView> {
    assertKeyVisible(this.authorization, user, input.alertKey);
    await this.states.clearHiding(user.userId, input.alertKey);
    return toDismissalView(input.alertKey, null, this.clock.now());
  }
}
