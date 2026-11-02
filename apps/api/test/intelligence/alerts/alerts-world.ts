import type { CurrentUser } from '../../../src/shared/application/current-user';
import type { EntityRef } from '../../../src/shared/domain/entity-ref';
import type { UserRole } from '../../../src/shared/domain/enums';
import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import { DismissAlert } from '../../../src/modules/intelligence/application/use-cases/alerts/dismiss-alert.use-case';
import { ListAlerts } from '../../../src/modules/intelligence/application/use-cases/alerts/list-alerts.use-case';
import { MarkAlertsRead } from '../../../src/modules/intelligence/application/use-cases/alerts/mark-alerts-read.use-case';
import { RestoreAlert } from '../../../src/modules/intelligence/application/use-cases/alerts/restore-alert.use-case';
import type {
  AlertSourcesReadPort,
  DocumentAlertRow,
  ExpenseAlertRow,
  InstallmentAlertRow,
  InvoiceAlertRow,
  PaymentAlertRow,
} from '../../../src/modules/intelligence/application/ports/alert-sources-read.port';
import type { AlertStateRepository } from '../../../src/modules/intelligence/application/ports/alert-state.repository.port';
import { addDays, type DateOnly } from '../../../src/shared/domain/business-date';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { InMemoryUnitOfWork } from '../../support/fakes/in-memory-unit-of-work';
import { InMemoryAlertSources } from './fakes/in-memory-alert-sources';
import { InMemoryAlertStateRepository } from './fakes/in-memory-alert-state.repository';

/** Thursday 2026-01-15 in Caracas (12:00 UTC is 08:00 there). */
export const NOW = '2026-01-15T12:00:00.000Z';
export const TODAY: DateOnly = '2026-01-15';

export function userOf(role: UserRole, id = `usr_${role.toLowerCase()}`): CurrentUser {
  return { userId: id, clerkId: `clerk_${id}`, role, email: `${id}@example.test`, name: id };
}

const ref = (type: EntityRef['type'], id: string): EntityRef => ({ type, id, label: id });

export const invoiceRow = (
  id: string,
  offsetDays: number,
  extra: Partial<InvoiceAlertRow> = {},
): InvoiceAlertRow => ({
  id,
  entity: ref('INVOICE', id),
  context: 'Kairos',
  archived: false,
  isDraft: false,
  status: 'EMITIDA',
  dueDate: addDays(TODAY, offsetDays),
  balance: '500.00',
  currency: 'USD',
  ...extra,
});

export const installmentRow = (
  id: string,
  offsetDays: number | null,
  extra: Partial<InstallmentAlertRow> = {},
): InstallmentAlertRow => ({
  id,
  entity: ref('PROJECT', 'pry_a'),
  context: id,
  archived: false,
  status: 'PENDIENTE',
  dueDate: offsetDays === null ? null : addDays(TODAY, offsetDays),
  amount: '300.00',
  currency: 'USD',
  ...extra,
});

export const documentRow = (
  id: string,
  offsetDays: number | null,
  extra: Partial<DocumentAlertRow> = {},
): DocumentAlertRow => ({
  id,
  entity: ref('DOCUMENT', id),
  context: 'NDA',
  archived: false,
  status: 'VIGENTE',
  expiresAt: offsetDays === null ? null : addDays(TODAY, offsetDays),
  alertDaysBefore: null,
  ...extra,
});

export const expenseRow = (
  id: string,
  offsetDays: number | null,
  extra: Partial<ExpenseAlertRow> = {},
): ExpenseAlertRow => ({
  id,
  entity: ref('EXPENSE', id),
  context: 'Hosting',
  archived: false,
  recurring: true,
  status: 'PENDIENTE',
  dueDate: offsetDays === null ? null : addDays(TODAY, offsetDays),
  amount: '40.00',
  currency: 'USD',
  ...extra,
});

export const paymentRow = (
  id: string,
  ageDays: number,
  extra: Partial<PaymentAlertRow> = {},
): PaymentAlertRow => ({
  id,
  entity: ref('PAYMENT', id),
  context: 'Kairos',
  archived: false,
  status: 'PENDIENTE_VERIFICACION',
  date: addDays(TODAY, -ageDays),
  amount: '100.00',
  unallocated: '100.00',
  currency: 'USD',
  ...extra,
});

export interface AlertsWorld {
  readonly clock: FixedClock;
  readonly sources: InMemoryAlertSources;
  readonly states: InMemoryAlertStateRepository;
  readonly list: ListAlerts;
  readonly markRead: MarkAlertsRead;
  readonly dismiss: DismissAlert;
  readonly restore: RestoreAlert;
}

/** The four use cases over the real permission matrix, in-memory ports and a frozen clock. */
export function buildAlertsWorld(
  sources: AlertSourcesReadPort = new InMemoryAlertSources(),
  states?: AlertStateRepository,
  clock: FixedClock = new FixedClock(NOW),
  uow = new InMemoryUnitOfWork(),
): AlertsWorld {
  const repo = states ?? new InMemoryAlertStateRepository(uow);
  const authorization = new MatrixAuthorization();
  return {
    clock,
    sources: sources as InMemoryAlertSources,
    states: repo as InMemoryAlertStateRepository,
    list: new ListAlerts(authorization, sources, repo, clock),
    markRead: new MarkAlertsRead(authorization, uow, repo, clock),
    dismiss: new DismissAlert(authorization, uow, repo, clock),
    restore: new RestoreAlert(authorization, uow, repo, clock),
  };
}
