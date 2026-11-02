import type { CurrentUser } from '../../../../../shared/application/current-user';
import type { AuthorizationPort } from '../../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import {
  snoozeUntil,
  toDismissalView,
  type AlertDismissalView,
  type AlertHiding,
} from '../../../domain/alert-state';
import type { AlertStateRepository } from '../../ports/alert-state.repository.port';
import { assertKeyVisible } from './alert-support';

export interface DismissAlertInput {
  readonly alertKey: string;
  /** 1 to 90 snoozes the alert for that many days; absent dismisses it for good. */
  readonly days?: number | undefined;
}

/**
 * `POST /alerts/{key}/dismiss`: with `days` sets `dismissedUntil` and clears `dismissedAt`; without, sets
 * `dismissedAt` and clears `dismissedUntil` (DT-163). The snooze ends by `ClockPort`. Own row, no activity.
 */
export class DismissAlert {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly states: AlertStateRepository,
    private readonly clock: ClockPort,
  ) {}

  async execute(user: CurrentUser, input: DismissAlertInput): Promise<AlertDismissalView> {
    assertKeyVisible(this.authorization, user, input.alertKey);
    const now = this.clock.now();
    const hiding: AlertHiding =
      input.days === undefined
        ? { dismissedAt: now, dismissedUntil: null }
        : { dismissedAt: null, dismissedUntil: snoozeUntil(now, input.days) };
    await this.uow.run(() => this.states.hide(user.userId, input.alertKey, hiding, now));
    return toDismissalView(input.alertKey, hiding, now);
  }
}
