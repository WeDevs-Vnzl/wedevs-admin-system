import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import type { ClientListRow } from '../../../src/modules/commercial/application/use-cases/client-support';
import type { ProjectListRowView } from '../../../src/modules/commercial/application/use-cases/project-views';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import type { DateOnly } from '../../../src/shared/domain/business-date';
import type { ClientStatus, ProjectStatus, UserRole } from '../../../src/shared/domain/enums';
import { InMemoryEntityMetricsRead } from '../../support/fakes/in-memory-entity-metrics-read';
import { InMemoryFinanceFactsRead } from '../../support/fakes/in-memory-finance-facts-read';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { FakeListSource, InMemoryOverviewRead } from './fakes';

/** Thursday 2026-10-15, 12:00 in Caracas. */
export const NOW = '2026-10-15T16:00:00.000Z';
export const TODAY: DateOnly = '2026-10-15';

export const authorization = new MatrixAuthorization();

export const userOf = (role: UserRole): CurrentUser => ({
  userId: `usr_${role.toLowerCase()}`,
  clerkId: `clerk_${role.toLowerCase()}`,
  role,
  email: `${role.toLowerCase()}@example.test`,
  name: role,
});

export const world = () => ({
  clock: new FixedClock(NOW),
  facts: new InMemoryFinanceFactsRead(),
  metrics: new InMemoryEntityMetricsRead(),
  overview: new InMemoryOverviewRead(),
});

export function clientRow(
  id: string,
  tradeName: string,
  createdAt: string,
  extra: Partial<ClientListRow> & { status?: ClientStatus } = {},
): ClientListRow {
  const { status, ...rest } = extra;
  return {
    client: {
      id,
      code: `CLI-${id}`,
      kind: 'EMPRESA',
      tradeName,
      legalName: tradeName,
      taxId: `J-${id}`,
      country: 'VE',
      address: 'Caracas',
      phone: '+58 212 0000000',
      email: null,
      website: null,
      status: status ?? 'ACTIVO',
      activatedAt: null,
      createdAt: new Date(createdAt),
      updatedAt: new Date(createdAt),
      deletedAt: null,
    },
    projectCount: 0,
    lastActivityAt: null,
    totalInvoicedUsd: '0.00',
    receivableUsd: '0.00',
    tags: [],
    ...rest,
  };
}

export function projectRow(
  id: string,
  extra: Partial<ProjectListRowView> & { status?: ProjectStatus } = {},
): ProjectListRowView {
  return {
    id,
    code: `PRY-${id}`,
    name: id,
    clients: [],
    status: 'EN_CURSO',
    startDate: null,
    targetEndDate: null,
    stack: [],
    tags: [],
    archivedAt: null,
    contractedValueUsd: '0.00',
    invoicedUsd: '0.00',
    collectedUsd: '0.00',
    toInvoiceUsd: '0.00',
    ...extra,
  };
}

export { FakeListSource };
