import type { CurrentUser } from '../../../../../shared/application/current-user';
import type { AuthorizationPort } from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import { addDays, todayInCaracas, type DateOnly } from '../../../../../shared/domain/business-date';
import { buildAlertKey } from '../../../domain/alert-key';
import {
  documentExpiredAlert,
  documentExpiringAlert,
  installmentToInvoiceAlert,
  invoiceDueSoonAlert,
  invoiceOverdueAlert,
  INSTALLMENT_DUE_DAYS,
  INVOICE_DUE_SOON_DAYS,
  missingRateAlert,
  PAYMENT_VERIFY_AFTER_DAYS,
  paymentPendingVerificationAlert,
  recurringExpensePendingAlert,
  RECURRING_EXPENSE_DUE_DAYS,
  UNALLOCATED_AFTER_DAYS,
  unallocatedCreditAlert,
  type AlertHit,
} from '../../../domain/alert-rules';
import { isAlertHidden, alertLimit } from '../../../domain/alert-state';
import { ALERT_TYPE_VALUES, type AlertType } from '../../../domain/alert-type';
import type { AlertSourcesReadPort } from '../../ports/alert-sources-read.port';
import type { AlertStateRepository } from '../../ports/alert-state.repository.port';
import { parseTypesFilter, visibleTypesOf, type AlertOutput } from './alert-support';

export interface ListAlertsInput {
  /** Narrows to some types, e.g. a module overview's own alerts. */
  readonly types?: readonly string[] | undefined;
  /** 1 to 200, 50 by default. */
  readonly limit?: number | undefined;
}

export interface AlertsInboxOutput {
  /** Active alerts after the caller's dismissals and snoozes; not capped by `limit`. */
  readonly total: number;
  readonly byType: Partial<Record<AlertType, number>>;
  readonly items: AlertOutput[];
  /** The bell counter: active alerts not marked read. */
  readonly unread: number;
  /** The active alerts already marked read. */
  readonly readKeys: string[];
}

const TYPE_ORDER = new Map<AlertType, number>(ALERT_TYPE_VALUES.map((type, i) => [type, i]));

function money(amount: string, currency: string): AlertOutput['amount'] {
  return { amount, currency };
}

/**
 * `GET /alerts` (PRD §7.9): the caller's live alerts, computed over the partial indexes and the pure rules,
 * minus what the caller dismissed or snoozed. `@Authenticated()` route; visibility is by data (DT-79, C13):
 * finance types need `canSeeFinancials`, documents `read document`, the rate `read settings`. The input is
 * validated here as well as in the DTO, so an internal caller (`/shell`) cannot bypass it.
 */
export class ListAlerts {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly sources: AlertSourcesReadPort,
    private readonly states: AlertStateRepository,
    private readonly clock: ClockPort,
  ) {}

  async execute(user: CurrentUser, input: ListAlertsInput = {}): Promise<AlertsInboxOutput> {
    const limit = alertLimit(input.limit);
    const wanted = parseTypesFilter(input.types);
    const visible = visibleTypesOf(this.authorization, user);
    const types = new Set(visible.filter((type) => wanted === null || wanted.includes(type)));

    const now = this.clock.now();
    const candidates = await this.collect(types, todayInCaracas(now));

    const states = await this.states.listByUser(
      user.userId,
      candidates.map((alert) => alert.alertKey),
    );
    const stateOf = new Map(states.map((state) => [state.alertKey, state]));
    const alerts = candidates
      .filter((alert) => {
        const state = stateOf.get(alert.alertKey);
        return state === undefined || !isAlertHidden(state, now);
      })
      .sort(
        (a, b) =>
          (a.days ?? 0) - (b.days ?? 0) ||
          (TYPE_ORDER.get(a.type) ?? 0) - (TYPE_ORDER.get(b.type) ?? 0) ||
          (a.alertKey < b.alertKey ? -1 : a.alertKey > b.alertKey ? 1 : 0),
      );

    const byType: Partial<Record<AlertType, number>> = {};
    for (const alert of alerts) byType[alert.type] = (byType[alert.type] ?? 0) + 1;
    const readKeys = alerts
      .map((alert) => alert.alertKey)
      .filter((key) => stateOf.get(key)?.readAt != null);
    return {
      total: alerts.length,
      byType,
      items: alerts.slice(0, limit),
      unread: alerts.length - readKeys.length,
      readKeys,
    };
  }

  private async collect(types: ReadonlySet<AlertType>, today: DateOnly): Promise<AlertOutput[]> {
    const out: AlertOutput[] = [];
    const push = (
      type: AlertType,
      subject: string,
      hit: AlertHit,
      fields: Pick<AlertOutput, 'entity' | 'amount' | 'context'>,
    ): void => {
      out.push({
        alertKey: buildAlertKey(type, subject),
        type,
        date: hit.date,
        days: hit.days,
        ...fields,
      });
    };
    const s = this.sources;

    await Promise.all([
      types.has('INVOICE_OVERDUE') &&
        s.overdueInvoices().then((rows) => {
          for (const row of rows) {
            const hit = invoiceOverdueAlert(row, today);
            if (hit)
              push('INVOICE_OVERDUE', row.id, hit, {
                entity: row.entity,
                amount: money(row.balance, row.currency),
                context: row.context,
              });
          }
        }),
      types.has('INVOICE_DUE_SOON') &&
        s
          .dueSoonInvoices({ from: today, to: addDays(today, INVOICE_DUE_SOON_DAYS) })
          .then((rows) => {
            for (const row of rows) {
              const hit = invoiceDueSoonAlert(row, today);
              if (hit)
                push('INVOICE_DUE_SOON', row.id, hit, {
                  entity: row.entity,
                  amount: money(row.balance, row.currency),
                  context: row.context,
                });
            }
          }),
      types.has('INSTALLMENT_TO_INVOICE') &&
        s.pendingInstallments(addDays(today, INSTALLMENT_DUE_DAYS)).then((rows) => {
          for (const row of rows) {
            const hit = installmentToInvoiceAlert(row, today);
            if (hit)
              push('INSTALLMENT_TO_INVOICE', row.id, hit, {
                entity: row.entity,
                amount: money(row.amount, row.currency),
                context: row.context,
              });
          }
        }),
      types.has('DOCUMENT_EXPIRING') &&
        s.expiringDocuments(today).then((rows) => {
          for (const row of rows) {
            const hit = documentExpiringAlert(row, today);
            if (hit)
              push('DOCUMENT_EXPIRING', row.id, hit, {
                entity: row.entity,
                amount: null,
                context: row.context,
              });
          }
        }),
      types.has('DOCUMENT_EXPIRED') &&
        s.expiredDocuments().then((rows) => {
          for (const row of rows) {
            const hit = documentExpiredAlert(row, today);
            if (hit)
              push('DOCUMENT_EXPIRED', row.id, hit, {
                entity: row.entity,
                amount: null,
                context: row.context,
              });
          }
        }),
      types.has('RECURRING_EXPENSE_PENDING') &&
        s.pendingRecurringExpenses(addDays(today, RECURRING_EXPENSE_DUE_DAYS)).then((rows) => {
          for (const row of rows) {
            const hit = recurringExpensePendingAlert(row, today);
            if (hit)
              push('RECURRING_EXPENSE_PENDING', row.id, hit, {
                entity: row.entity,
                amount: money(row.amount, row.currency),
                context: row.context,
              });
          }
        }),
      types.has('PAYMENT_PENDING_VERIFICATION') &&
        s
          .pendingVerificationPayments(addDays(today, -(PAYMENT_VERIFY_AFTER_DAYS + 1)))
          .then((rows) => {
            for (const row of rows) {
              const hit = paymentPendingVerificationAlert(row, today);
              if (hit)
                push('PAYMENT_PENDING_VERIFICATION', row.id, hit, {
                  entity: row.entity,
                  amount: money(row.amount, row.currency),
                  context: row.context,
                });
            }
          }),
      types.has('UNALLOCATED_CREDIT') &&
        s.unallocatedPayments(addDays(today, -(UNALLOCATED_AFTER_DAYS + 1))).then((rows) => {
          for (const row of rows) {
            const hit = unallocatedCreditAlert(row, today);
            if (hit)
              push('UNALLOCATED_CREDIT', row.id, hit, {
                entity: row.entity,
                amount: money(row.unallocated, row.currency),
                context: row.context,
              });
          }
        }),
      types.has('MISSING_RATE') &&
        s.hasVesRate(today).then((hasRateToday) => {
          const hit = missingRateAlert({ hasRateToday }, today);
          if (hit)
            push('MISSING_RATE', hit.subject, hit, { entity: null, amount: null, context: null });
        }),
    ]);
    return out;
  }
}
