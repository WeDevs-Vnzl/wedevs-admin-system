import type { FinanceProjector } from '../../../src/modules/finance/application/finance-projector';
import type {
  InvoiceFilesPort,
  InvoiceFiscalPort,
  InvoiceReferencesPort,
} from '../../../src/modules/finance/application/ports/invoice-references.port';
import type { InvoiceRecord } from '../../../src/modules/finance/application/ports/invoice.repository.port';
import type {
  PaymentReceiptFilesPort,
  PaymentReferencesPort,
} from '../../../src/modules/finance/application/ports/payment-references.port';
import type {
  PaymentAllocationRecord,
  PaymentMethodRef,
  PaymentRecord,
} from '../../../src/modules/finance/application/ports/payment.repository.port';
import { InvoiceSupport } from '../../../src/modules/finance/application/use-cases/invoices/invoice-support';
import { RecomputeInvoice } from '../../../src/modules/finance/application/use-cases/invoices/recompute-invoice.use-case';
import {
  AllocatePayment,
  DeallocatePayment,
} from '../../../src/modules/finance/application/use-cases/payments/allocate-payment.use-case';
import { CreatePayment } from '../../../src/modules/finance/application/use-cases/payments/create-payment.use-case';
import {
  DetectDuplicatePayment,
  GetClientCredit,
  GetInvoiceForPayment,
  GetPayment,
  ListPayments,
} from '../../../src/modules/finance/application/use-cases/payments/payment-reads.use-case';
import { PaymentSupport } from '../../../src/modules/finance/application/use-cases/payments/payment-support';
import { SetPaymentStatus } from '../../../src/modules/finance/application/use-cases/payments/set-payment-status.use-case';
import { UpdatePayment } from '../../../src/modules/finance/application/use-cases/payments/update-payment.use-case';
import {
  computeInvoiceTotals,
  computeLineAmounts,
} from '../../../src/modules/finance/domain/invoice-totals';
import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import { NotFoundError } from '../../../src/shared/domain/domain-error';
import type { EntityRef } from '../../../src/shared/domain/entity-ref';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { InMemoryActivityLog } from '../../support/fakes/in-memory-activity-log';
import { InMemoryRowLocks } from '../../support/fakes/in-memory-row-locks';
import { InMemorySearchIndex } from '../../support/fakes/in-memory-search-index';
import { InMemorySequence } from '../../support/fakes/in-memory-sequence';
import { InMemoryUnitOfWork } from '../../support/fakes/in-memory-unit-of-work';
import { SequentialIdGenerator } from '../../support/fakes/sequential-id-generator';
import {
  KAIROS,
  LABS,
  NOW,
  SEED_LINE,
  WEB,
  WEB_1,
  ZAFIRO,
  invoiceRecord,
  query,
  rejection,
  userOf,
} from '../invoices/world';
import {
  InMemoryPaymentRepository,
  LinkedInvoiceRepository,
} from './fakes/in-memory-payment.repository';

export { KAIROS, NOW, WEB, WEB_1, ZAFIRO, LABS, query, rejection, userOf };

export const ACC_USD = 'acc_usd';
export const ACC_VES = 'acc_ves';
export const ACC_OFF = 'acc_off';
export const ACC_USD_2 = 'acc_usd_2';
export const PM_ZELLE = 'pmt_zelle';
export const PM_CASH = 'pmt_cash';

/** A valid create input (100 USD to the USD account, reference given), overridden field by field. */
export function paymentInput(over: Record<string, unknown> = {}) {
  return {
    clientId: KAIROS,
    date: '2026-10-05',
    accountId: ACC_USD,
    methodId: PM_ZELLE,
    currency: 'USD',
    amount: '100.00',
    igtfAmount: '0.00',
    feeAmount: '0.00',
    usdRate: '1',
    reference: 'REF-TEST-1',
    ...over,
  } as never;
}

/** A stored confirmed payment of 100 USD with nothing allocated. */
export const paymentRecord = (over: Partial<PaymentRecord> = {}): PaymentRecord => ({
  id: 'pay_seed',
  code: 'PAG-0100',
  clientId: KAIROS,
  date: '2026-09-10',
  accountId: ACC_USD,
  methodId: PM_ZELLE,
  currency: 'USD',
  amount: '100.00',
  igtfAmount: '0.00',
  feeAmount: '0.00',
  netCredited: '100.00',
  allocatable: '100.00',
  unallocated: '100.00',
  usdRate: '1',
  amountUsd: '100.00',
  reference: 'SEED-1',
  status: 'CONFIRMADO',
  receiptFileId: null,
  createdAt: NOW,
  updatedAt: NOW,
  createdById: null,
  updatedById: null,
  ...over,
});

/** Calls the projector in order, so a test can assert what a mutation recomputed. */
export class RecordingProjector {
  readonly calls: string[] = [];
  projectInvoice = async (id: string) => void this.calls.push(`invoice:${id}`);
  projectPayment = async (id: string) => void this.calls.push(`payment:${id}`);
  projectAccount = async (id: string) => void this.calls.push(`account:${id}`);
  projectClients = async (ids: readonly string[]) =>
    void this.calls.push(`clients:${[...ids].sort().join(',')}`);
  projectProjects = async (ids: readonly string[]) =>
    void this.calls.push(`projects:${[...ids].sort().join(',')}`);
}

/** The payment use cases over in-memory ports, the real invoice recompute and the real permission matrix. */
export function createPaymentsWorld() {
  const uow = new InMemoryUnitOfWork();
  const payments = new InMemoryPaymentRepository(uow);
  const invoices = new LinkedInvoiceRepository(uow, () => payments);
  const activity = new InMemoryActivityLog(uow);
  const search = new InMemorySearchIndex(uow);
  const sequence = new InMemorySequence(uow);
  const locks = new InMemoryRowLocks(uow);
  const clock = new FixedClock(NOW);
  const ids = new SequentialIdGenerator('gen');
  const authorization = new MatrixAuthorization();
  const projector = new RecordingProjector();

  const clients = new Map<string, EntityRef>([
    [KAIROS, { type: 'CLIENT', id: KAIROS, code: 'CLI-0001', label: 'Kairos' }],
    [ZAFIRO, { type: 'CLIENT', id: ZAFIRO, code: 'CLI-0002', label: 'Zafiro Labs' }],
  ]);
  const accounts = new Map([
    [ACC_USD, { id: ACC_USD, name: 'Zelle', currency: 'USD', active: true }],
    [ACC_USD_2, { id: ACC_USD_2, name: 'Caja', currency: 'USD', active: true }],
    [ACC_VES, { id: ACC_VES, name: 'Banco VES', currency: 'VES', active: true }],
    [ACC_OFF, { id: ACC_OFF, name: 'Cerrada', currency: 'USD', active: false }],
  ]);
  const methods = new Map<string, PaymentMethodRef & { requiresReference: boolean }>([
    [
      PM_ZELLE,
      { id: PM_ZELLE, code: 'ZELLE', name: 'Zelle', nameEn: null, requiresReference: true },
    ],
    [
      PM_CASH,
      { id: PM_CASH, code: 'EFECTIVO', name: 'Efectivo', nameEn: 'Cash', requiresReference: false },
    ],
  ]);
  const references: PaymentReferencesPort = {
    liveClient: async (id) => clients.get(id) ?? null,
    account: async (id) => accounts.get(id) ?? null,
    activeMethod: async (id) => {
      const method = methods.get(id);
      return method ? { id: method.id, requiresReference: method.requiresReference } : null;
    },
  };
  payments.labelsOf = {
    client: (id) => clients.get(id) ?? { type: 'CLIENT', id, label: id },
    account: (id) => ({ type: 'ACCOUNT', id, label: accounts.get(id)?.name ?? id }),
    method: (id) => {
      const method = methods.get(id);
      return {
        id,
        code: method?.code ?? id,
        name: method?.name ?? id,
        nameEn: method?.nameEn ?? null,
      };
    },
    invoice: (id) => invoices.all.find((row) => row.id === id),
  };

  const knownReceipts = new Map<string, { mimeType: string; sizeBytes: number }>([
    ['file_pdf', { mimeType: 'application/pdf', sizeBytes: 1024 * 1024 }],
    ['file_png', { mimeType: 'image/png', sizeBytes: 1024 * 1024 }],
    ['file_jpg', { mimeType: 'image/jpeg', sizeBytes: 1024 * 1024 }],
    ['file_webp', { mimeType: 'image/webp', sizeBytes: 1024 * 1024 }],
    ['file_zip', { mimeType: 'application/zip', sizeBytes: 1024 }],
    ['file_big', { mimeType: 'application/pdf', sizeBytes: 10 * 1024 * 1024 + 1 }],
    ['file_empty', { mimeType: 'application/pdf', sizeBytes: 0 }],
  ]);
  const reservedReceipts: string[] = [];
  const receipts: PaymentReceiptFilesPort = {
    reserve: async (_actor, fileId) => {
      if (fileId === 'file_boom') throw new Error('storage down');
      const file = knownReceipts.get(fileId);
      if (!file) throw new NotFoundError();
      reservedReceipts.push(fileId);
      return { id: fileId, ...file };
    },
  };

  const invoiceReferences: InvoiceReferencesPort = {
    liveClient: async (id) => clients.get(id) ?? null,
    liveProject: async () => null,
    projectBelongsToClient: async () => true,
    liveProjectsOfClient: async () => [],
  };
  const fiscal: InvoiceFiscalPort = { allowedIvaRates: async () => ['16', '8', '0'] };
  const invoiceFiles: InvoiceFilesPort = {
    reserve: async (_actor, id) => ({ id, mimeType: 'application/pdf', sizeBytes: 1 }),
  };
  const recomputedInstallments: string[][] = [];
  const invoiceSupport = new InvoiceSupport(
    invoices,
    invoiceReferences,
    fiscal,
    invoiceFiles,
    { knownCodes: async (codes: readonly string[]) => new Set(codes) },
    projector as unknown as FinanceProjector,
    {
      execute: async (installmentIds: readonly string[]) => {
        recomputedInstallments.push([...installmentIds].sort());
        return [];
      },
    },
    search,
    activity,
    clock,
    locks,
  );
  const recomputeInvoice = new RecomputeInvoice(invoiceSupport);

  const support = new PaymentSupport(
    payments,
    invoices,
    references,
    receipts,
    invoiceSupport,
    recomputeInvoice,
    projector as unknown as FinanceProjector,
    search,
    activity,
    clock,
    locks,
  );

  invoices.seedInstallment({
    id: WEB_1,
    projectId: WEB,
    label: 'Anticipo',
    currency: 'USD',
    amount: '4000.00',
    cancelled: false,
  });

  /** An open invoice with one exempt line, so its receivable is the given amount. */
  function addInvoice(
    id: string,
    receivable: string,
    options: Partial<InvoiceRecord> & {
      projectId?: string | null;
      installmentId?: string | null;
    } = {},
  ): InvoiceRecord {
    const { projectId = null, installmentId = null, ...over } = options;
    const usdRate = over.usdRate ?? '1';
    const amounts = computeLineAmounts({
      quantity: '1',
      unitPrice: receivable,
      discount: '0.00',
      ivaRate: null,
    });
    const totals = computeInvoiceTotals({
      lines: [{ quantity: '1', unitPrice: receivable, discount: '0.00', ivaRate: null }],
      taxAdjustments: [],
      ivaWithheld: '0.00',
      islrWithheld: '0.00',
      otherWithheld: '0.00',
      usdRate,
    });
    const record = invoiceRecord({
      id,
      code: `FAC-T-${id}`,
      invoiceNumber: `N-${id}`,
      clientId: KAIROS,
      currency: 'USD',
      dueDate: '2026-12-31',
      subtotal: totals.subtotal,
      discount: totals.discount,
      exemptAmount: totals.exemptAmount,
      taxBase: totals.taxBase,
      ivaAmount: totals.ivaAmount,
      total: totals.total,
      receivable: totals.receivable,
      totalUsd: totals.totalUsd,
      receivableUsd: totals.receivableUsd,
      balance: totals.receivable,
      taxLines: totals.taxLines,
      lines: [
        {
          ...SEED_LINE,
          id: `${id}_l1`,
          unitPrice: receivable,
          amount: amounts.amount,
          netAmount: amounts.netAmount,
          ivaRate: null,
          projectId,
          installmentId,
        },
      ],
      ...over,
    });
    invoices.seed(record);
    return record;
  }

  return {
    uow,
    payments,
    invoices,
    activity,
    search,
    locks,
    clock,
    sequence,
    projector,
    recomputedInstallments,
    reservedReceipts,
    accounts,
    methods,
    clients,
    addInvoice,
    owner: userOf('OWNER'),
    admin: userOf('ADMIN'),
    member: userOf('MEMBER'),
    viewer: userOf('VIEWER'),
    list: new ListPayments(authorization, payments),
    get: new GetPayment(authorization, payments),
    credit: new GetClientCredit(authorization, payments, references),
    duplicates: new DetectDuplicatePayment(authorization, payments),
    paymentContext: new GetInvoiceForPayment(authorization, invoices, references),
    create: new CreatePayment(authorization, uow, support, sequence, ids),
    update: new UpdatePayment(authorization, uow, support),
    setStatus: new SetPaymentStatus(authorization, uow, support),
    allocate: new AllocatePayment(authorization, uow, support, ids),
    deallocate: new DeallocatePayment(authorization, uow, support),
    recomputeInvoice,
    support,
  };
}

export type PaymentsWorld = ReturnType<typeof createPaymentsWorld>;

/** A live allocation row of the seeded payment, for tests that seed state directly. */
export const allocationRecord = (
  over: Partial<PaymentAllocationRecord> = {},
): PaymentAllocationRecord => ({
  id: 'alo_seed',
  paymentId: 'pay_seed',
  invoiceId: 'inv_seed',
  amountPaymentCurrency: '50.00',
  amountInvoiceCurrency: '50.00',
  amountUsd: '50.00',
  createdAt: NOW,
  createdById: null,
  deletedAt: null,
  ...over,
});
