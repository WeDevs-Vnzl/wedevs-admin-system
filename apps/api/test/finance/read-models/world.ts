import type { PrismaClient } from '../../../src/generated/prisma/client';
import { FinanceProjector } from '../../../src/modules/finance/application/finance-projector';
import { computePaymentAmounts } from '../../../src/modules/finance/domain/payments';
import { toUsd } from '../../../src/shared/domain/money';
import { RecomputeAll } from '../../../src/modules/finance/application/recompute-all';
import {
  computeInvoiceTotals,
  computeLineAmounts,
} from '../../../src/modules/finance/domain/invoice-totals';
import { PrismaFinanceSources } from '../../../src/modules/finance/infrastructure/prisma-finance-sources';
import { PrismaReadModelWriter } from '../../../src/modules/finance/infrastructure/prisma-read-model-writer';
import type { ClientMetricsWriterPort } from '../../../src/shared/application/ports/client-metrics-writer.port';
import { stringToDecimal as dec } from '../../../src/shared/infrastructure/prisma/decimal-mapper';
import { PrismaActivityLog } from '../../../src/shared/infrastructure/prisma/prisma-activity-log';
import { PrismaClientMetricsWriter } from '../../../src/shared/infrastructure/prisma/prisma-client-metrics-writer';
import { PrismaRowLocks } from '../../../src/shared/infrastructure/prisma/prisma-row-locks';
import { PrismaUnitOfWork } from '../../../src/shared/infrastructure/prisma/prisma-unit-of-work';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import {
  TransactionHost,
  type DbClient,
} from '../../../src/shared/infrastructure/prisma/transaction-host';
import { SystemClock } from '../../../src/shared/infrastructure/system-clock.adapter';
import type { ClockPort } from '../../../src/shared/application/ports/clock.port';

export interface WorldHooks {
  /** Decorates the writer, e.g. to pause a transaction at a `Gate`. */
  writer?: (writer: PrismaReadModelWriter) => PrismaReadModelWriter;
  sources?: (sources: PrismaFinanceSources) => PrismaFinanceSources;
  clock?: ClockPort;
}

/** The finance read-model pieces over real adapters, sharing one `TransactionHost` per world. */
export function buildWorld(service: PrismaService, hooks: WorldHooks = {}) {
  const host = new TransactionHost(service);
  const uow = new PrismaUnitOfWork(host);
  const clock = hooks.clock ?? new SystemClock();
  const sources = (hooks.sources ?? ((s) => s))(new PrismaFinanceSources(host));
  const writer = (hooks.writer ?? ((w) => w))(new PrismaReadModelWriter(host));
  const projector = new FinanceProjector(sources, writer, clock);
  const metrics: ClientMetricsWriterPort = new PrismaClientMetricsWriter(host);
  const recomputeAll = new RecomputeAll(
    uow,
    new PrismaRowLocks(host),
    sources,
    writer,
    projector,
    new PrismaActivityLog(host, metrics),
    clock,
  );
  return { host, uow, projector, recomputeAll, sources, writer, metrics };
}

export type World = ReturnType<typeof buildWorld>;

let seq = 0;
const next = () => String(++seq).padStart(4, '0');

export async function seedClient(db: DbClient, id: string) {
  return db.client.create({
    data: {
      id,
      code: `CLI-${next()}`,
      kind: 'EMPRESA',
      tradeName: id,
      legalName: `${id} C.A.`,
      taxId: `J-${next()}`,
      country: 'VE',
      address: 'Av. Principal',
      phone: '+584121234567',
    },
  });
}

export async function seedProject(db: DbClient, id: string, clientIds: readonly string[]) {
  return db.project.create({
    data: {
      id,
      code: `PRY-${next()}`,
      name: id,
      summary: 'Resumen',
      clients: { create: clientIds.map((clientId) => ({ clientId })) },
    },
  });
}

export async function seedAccount(db: DbClient, id: string, currency = 'USD', opening = '0.00') {
  return db.account.create({
    data: {
      id,
      name: id,
      type: 'BANCO_INTERNACIONAL',
      currency,
      openingBalance: dec(opening),
      openingDate: new Date('2026-01-01'),
    },
  });
}

export async function catalogIds(db: DbClient) {
  const method = await db.paymentMethod.findFirstOrThrow({ orderBy: { code: 'asc' } });
  const category = await db.expenseCategory.findFirstOrThrow({ orderBy: { id: 'asc' } });
  return { methodId: method.id, categoryId: category.id };
}

export interface InvoiceSpec {
  id: string;
  clientId: string;
  currency?: string;
  usdRate?: string;
  issueDate?: string;
  dueDate?: string;
  status?: 'BORRADOR' | 'EMITIDA' | 'PARCIAL' | 'PAGADA' | 'VENCIDA' | 'ANULADA';
  archived?: boolean;
  ivaWithheld?: string;
  lines: {
    id: string;
    projectId: string | null;
    unitPrice: string;
    discount?: string;
    ivaRate: string | null;
    installmentId?: string;
  }[];
}

/** Inserts an invoice with the totals the domain computes (C17), as a mutation would persist them. */
export async function seedInvoice(db: DbClient, spec: InvoiceSpec) {
  const usdRate = spec.usdRate ?? '1';
  const totals = computeInvoiceTotals({
    lines: spec.lines.map((line) => ({
      quantity: '1',
      unitPrice: line.unitPrice,
      discount: line.discount ?? '0.00',
      ivaRate: line.ivaRate,
    })),
    taxAdjustments: [],
    ivaWithheld: spec.ivaWithheld ?? '0.00',
    islrWithheld: '0.00',
    otherWithheld: '0.00',
    usdRate,
  });
  const status = spec.status ?? 'EMITIDA';
  await db.invoice.create({
    data: {
      id: spec.id,
      code: `FAC-${next()}`,
      clientId: spec.clientId,
      invoiceNumber: `N-${spec.id}`,
      issueDate: new Date(spec.issueDate ?? '2026-02-01'),
      dueDate: new Date(spec.dueDate ?? '2026-12-31'),
      currency: spec.currency ?? 'USD',
      usdRate: dec(usdRate),
      subtotal: dec(totals.subtotal),
      discount: dec(totals.discount),
      exemptAmount: dec(totals.exemptAmount),
      taxBase: dec(totals.taxBase),
      ivaAmount: dec(totals.ivaAmount),
      total: dec(totals.total),
      ivaWithheld: dec(spec.ivaWithheld ?? '0.00'),
      receivable: dec(totals.receivable),
      totalUsd: dec(totals.totalUsd),
      receivableUsd: dec(totals.receivableUsd),
      balance: dec(totals.receivable),
      isDraft: status === 'BORRADOR',
      status,
      voidedAt: status === 'ANULADA' ? new Date('2026-02-02') : null,
      deletedAt: spec.archived ? new Date('2026-02-03') : null,
      lines: {
        create: spec.lines.map((line, index) => {
          const amounts = computeLineAmounts({
            quantity: '1',
            unitPrice: line.unitPrice,
            discount: line.discount ?? '0.00',
            ivaRate: line.ivaRate,
          });
          return {
            id: line.id,
            projectId: line.projectId,
            installmentId: line.installmentId ?? null,
            description: line.id,
            unitPrice: dec(line.unitPrice),
            amount: dec(amounts.amount),
            discount: dec(line.discount ?? '0.00'),
            netAmount: dec(amounts.netAmount),
            ivaRate: line.ivaRate === null ? null : dec(line.ivaRate),
            order: index,
          };
        }),
      },
      taxLines: {
        create: totals.taxLines.map((line) => ({
          ivaRate: dec(line.ivaRate),
          taxBase: dec(line.taxBase),
          ivaAmount: dec(line.ivaAmount),
        })),
      },
    },
  });
  return totals;
}

export interface PaymentSpec {
  id: string;
  clientId: string;
  accountId: string;
  methodId: string;
  amount: string;
  currency?: string;
  usdRate?: string;
  igtfAmount?: string;
  feeAmount?: string;
  date?: string;
  status?: 'PENDIENTE_VERIFICACION' | 'CONFIRMADO' | 'ANULADO';
  archived?: boolean;
  allocations?: {
    id: string;
    invoiceId: string;
    amountPaymentCurrency: string;
    amountInvoiceCurrency: string;
    amountUsd: string;
    deleted?: boolean;
  }[];
}

/** Inserts a payment with the caches the domain computes (§9.6); allocations are live unless `deleted`. */
export async function seedPayment(db: DbClient, spec: PaymentSpec) {
  const usdRate = spec.usdRate ?? '1';
  const allocations = spec.allocations ?? [];
  const amounts = computePaymentAmounts({
    amount: spec.amount,
    igtfAmount: spec.igtfAmount ?? '0.00',
    feeAmount: spec.feeAmount ?? '0.00',
    allocated: allocations.filter((a) => !a.deleted).map((a) => a.amountPaymentCurrency),
  });
  await db.payment.create({
    data: {
      id: spec.id,
      code: `PAG-${next()}`,
      clientId: spec.clientId,
      date: new Date(spec.date ?? '2026-02-10'),
      accountId: spec.accountId,
      methodId: spec.methodId,
      currency: spec.currency ?? 'USD',
      amount: dec(spec.amount),
      igtfAmount: dec(spec.igtfAmount ?? '0.00'),
      feeAmount: dec(spec.feeAmount ?? '0.00'),
      netCredited: dec(amounts.netCredited),
      allocatable: dec(amounts.allocatable),
      unallocated: dec(amounts.unallocated),
      usdRate: dec(usdRate),
      amountUsd: dec(toUsd(spec.amount, usdRate)),
      status: spec.status ?? 'CONFIRMADO',
      deletedAt: spec.archived ? new Date('2026-02-11') : null,
      allocations: {
        create: allocations.map((a) => ({
          id: a.id,
          invoiceId: a.invoiceId,
          amountPaymentCurrency: dec(a.amountPaymentCurrency),
          amountInvoiceCurrency: dec(a.amountInvoiceCurrency),
          amountUsd: dec(a.amountUsd),
          deletedAt: a.deleted ? new Date('2026-02-12') : null,
        })),
      },
    },
  });
}

export interface ExpenseSpec {
  id: string;
  categoryId: string;
  amount: string;
  currency?: string;
  usdRate?: string;
  accountId?: string | null;
  accountAmount?: string | null;
  projectId?: string | null;
  status?: 'PENDIENTE' | 'PAGADO' | 'ANULADO';
  date?: string;
  paidAt?: string | null;
  archived?: boolean;
}

export async function seedExpense(db: DbClient, spec: ExpenseSpec) {
  const usdRate = spec.usdRate ?? '1';
  await db.expense.create({
    data: {
      id: spec.id,
      code: `GAS-${next()}`,
      date: new Date(spec.date ?? '2026-02-15'),
      paidAt: spec.paidAt ? new Date(spec.paidAt) : null,
      description: spec.id,
      categoryId: spec.categoryId,
      accountId: spec.accountId ?? null,
      accountAmount: spec.accountAmount == null ? null : dec(spec.accountAmount),
      projectId: spec.projectId ?? null,
      currency: spec.currency ?? 'USD',
      amount: dec(spec.amount),
      usdRate: dec(usdRate),
      amountUsd: dec(toUsd(spec.amount, usdRate)),
      status: spec.status ?? 'PAGADO',
      deletedAt: spec.archived ? new Date('2026-02-16') : null,
    },
  });
}

/** One `SearchEntry` row, the way a use case's `SearchIndexPort.upsert` would leave it (the list `q` reads these). */
export async function seedSearchEntry(
  client: Pick<DbClient, 'searchEntry'> | Pick<PrismaClient, 'searchEntry'>,
  entry: {
    entityType: 'INVOICE' | 'PAYMENT' | 'EXPENSE';
    entityId: string;
    code?: string | null;
    title: string;
    subtitle?: string | null;
    body?: string | null;
    archived?: boolean;
  },
) {
  const db = client as Pick<DbClient, 'searchEntry'>;
  await db.searchEntry.create({
    data: {
      entityType: entry.entityType,
      entityId: entry.entityId,
      code: entry.code ?? null,
      title: entry.title,
      subtitle: entry.subtitle ?? null,
      body: entry.body ?? null,
      archived: entry.archived ?? false,
    },
  });
}
