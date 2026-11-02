import type { CurrentUser } from '../../../../../shared/application/current-user';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import {
  isBusinessDay,
  todayInCaracas,
  type DateOnly,
} from '../../../../../shared/domain/business-date';
import type { UserRole } from '../../../../../shared/domain/enums';
import type { MoneyString } from '../../../../../shared/domain/money';
import type { ExchangeRatePort } from '../../../../finance/application/ports/exchange-rate.port';
import type { AlertType } from '../../../domain/alert-type';
import type { ListAlerts } from '../alerts/list-alerts.use-case';

export interface ShellOutput {
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly role: UserRole;
  };
  /** The VES chip: the rate of today, or the latest earlier one; `null` when none exists at all. */
  readonly vesRate: {
    /** Date of the rate shown. */
    readonly date: DateOnly;
    readonly usdRate: MoneyString;
    readonly source: string | null;
  } | null;
  /** A business day without a VES rate (or no rate at all): the chip shows a warning. */
  readonly vesRateMissing: boolean;
  readonly alerts: {
    readonly total: number;
    readonly unread: number;
    readonly byType: Partial<Record<AlertType, number>>;
  };
}

/**
 * `GET /shell`: what every page needs: the caller, the VES rate chip and the bell counters. The route is
 * `@Authenticated()`; the alert counters are the caller's own through `ListAlerts` (which gates each alert
 * type by data), so nothing here needs a grant of its own.
 */
export class GetShell {
  constructor(
    private readonly alerts: ListAlerts,
    private readonly rates: ExchangeRatePort,
    private readonly clock: ClockPort,
  ) {}

  async execute(user: CurrentUser): Promise<ShellOutput> {
    const today = todayInCaracas(this.clock.now());
    const [rate, inbox] = await Promise.all([
      this.rates.getRateFor(today, 'VES'),
      this.alerts.execute(user, { limit: 1 }),
    ]);
    return {
      user: { id: user.userId, name: user.name, email: user.email, role: user.role },
      vesRate: rate
        ? { date: rate.effectiveDate, usdRate: rate.usdRate, source: rate.source }
        : null,
      // A weekend has no rate by design; only a business day without one is a gap.
      vesRateMissing: rate === null || (rate.isFallback && isBusinessDay(today)),
      alerts: { total: inbox.total, unread: inbox.unread, byType: inbox.byType },
    };
  }
}
