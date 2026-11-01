import {
  caracasDayStart,
  toActivityCriteria,
} from '../../../../platform/application/use-cases/list-activity.use-case';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import { addDays, todayInCaracas } from '../../../../../shared/domain/business-date';
import type { ListQuery } from '../../../../../shared/domain/list-query';
import type { ActivityCounts, OverviewReadPort } from '../../ports/overview-read.port';

export type ActivityOverview = ActivityCounts;

/**
 * `GET /activity/overview` (X17, DT-174): `{ total, today, users }` in one call. `can(read, activity)` first
 * (Owner and Admin). The filter is `GET /activity`'s and is validated by the same rules: `total` follows it,
 * `users` is `total` restricted to actions of users, and `today` counts the Caracas day whatever the filter.
 */
export class GetActivityOverview {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly overview: OverviewReadPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, query: ListQuery): Promise<ActivityOverview> {
    assertCan(this.authorization, actor, 'read', 'activity');
    const filter = toActivityCriteria(query);
    const today = todayInCaracas(this.clock.now());
    return this.overview.activityCounts({
      filter,
      todayStart: caracasDayStart(today),
      tomorrowStart: caracasDayStart(addDays(today, 1)),
    });
  }
}
