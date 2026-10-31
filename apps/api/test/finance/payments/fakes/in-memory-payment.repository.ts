import type {
  InvoiceAllocationState,
  InvoiceRecord,
} from '../../../../src/modules/finance/application/ports/invoice.repository.port';
import type {
  CreditRowView,
  DuplicateMatchView,
  DuplicateQuery,
  PaymentAllocationRecord,
  PaymentAllocationView,
  PaymentFilter,
  PaymentLabel,
  PaymentListRowView,
  PaymentMethodRef,
  PaymentRecord,
  PaymentRepository,
  PaymentView,
} from '../../../../src/modules/finance/application/ports/payment.repository.port';
import { ConflictError } from '../../../../src/shared/domain/domain-error';
import type { EntityRef } from '../../../../src/shared/domain/entity-ref';
import { subMoney, sumMoney } from '../../../../src/shared/domain/money';
import { paginated, type Paginated } from '../../../../src/shared/domain/pagination';
import type {
  InMemoryUnitOfWork,
  TransactionParticipant,
} from '../../../support/fakes/in-memory-unit-of-work';
import { InMemoryInvoiceRepository } from '../../invoices/fakes/in-memory-invoice.repository';

/** What the fake repository needs to label a payment, the way the Prisma joins do. */
export interface PaymentLabels {
  client(id: string): EntityRef;
  account(id: string): EntityRef;
  method(id: string): PaymentMethodRef;
  invoice(id: string): InvoiceRecord | undefined;
}

/** Fake `PaymentRepository`: rows roll back with the unit of work like the database. */
export class InMemoryPaymentRepository implements PaymentRepository, TransactionParticipant {
  private rows = new Map<string, PaymentRecord>();
  private allocations = new Map<string, PaymentAllocationRecord>();
  private snapshot: {
    rows: Map<string, PaymentRecord>;
    allocations: Map<string, PaymentAllocationRecord>;
  } | null = null;
  labelsOf: PaymentLabels | null = null;

  constructor(uow?: InMemoryUnitOfWork) {
    uow?.enlist(this);
  }

  get all(): readonly PaymentRecord[] {
    return [...this.rows.values()];
  }

  /** Every allocation, deleted ones included. */
  get allAllocations(): readonly PaymentAllocationRecord[] {
    return [...this.allocations.values()];
  }

  seed(record: PaymentRecord, allocations: readonly PaymentAllocationRecord[] = []): void {
    this.rows.set(record.id, record);
    for (const allocation of allocations) this.allocations.set(allocation.id, allocation);
  }

  begin(): void {
    this.snapshot = { rows: new Map(this.rows), allocations: new Map(this.allocations) };
  }

  commit(): void {
    this.snapshot = null;
  }

  rollback(): void {
    if (this.snapshot) {
      this.rows = this.snapshot.rows;
      this.allocations = this.snapshot.allocations;
    }
    this.snapshot = null;
  }

  /** The live allocations of an invoice, as the invoice repository reads them. */
  allocationStates(invoiceId: string): InvoiceAllocationState[] {
    return [...this.allocations.values()]
      .filter((allocation) => allocation.invoiceId === invoiceId && allocation.deletedAt === null)
      .flatMap((allocation) => {
        const payment = this.rows.get(allocation.paymentId);
        if (!payment || payment.status === 'ANULADO') return [];
        return [
          {
            paymentId: payment.id,
            amountInvoiceCurrency: allocation.amountInvoiceCurrency,
            paymentStatus: payment.status,
          },
        ];
      });
  }

  async findById(id: string): Promise<PaymentRecord | null> {
    return this.rows.get(id) ?? null;
  }

  async insert(record: PaymentRecord): Promise<void> {
    this.rows.set(record.id, record);
  }

  async update(record: PaymentRecord): Promise<void> {
    this.rows.set(record.id, record);
  }

  async liveAllocations(paymentId: string): Promise<PaymentAllocationRecord[]> {
    return [...this.allocations.values()].filter(
      (allocation) => allocation.paymentId === paymentId && allocation.deletedAt === null,
    );
  }

  async findAllocation(id: string): Promise<PaymentAllocationRecord | null> {
    return this.allocations.get(id) ?? null;
  }

  async insertAllocation(record: PaymentAllocationRecord): Promise<void> {
    const taken = [...this.allocations.values()].some(
      (allocation) =>
        allocation.paymentId === record.paymentId &&
        allocation.invoiceId === record.invoiceId &&
        allocation.deletedAt === null,
    );
    if (taken)
      throw new ConflictError({ message: 'payments.validation.duplicateInvoiceAllocation' });
    this.allocations.set(record.id, record);
  }

  async updateAllocationUsd(id: string, amountUsd: string): Promise<void> {
    const row = this.allocations.get(id);
    if (row && row.deletedAt === null) this.allocations.set(id, { ...row, amountUsd });
  }

  async softDeleteAllocations(ids: readonly string[], deletedAt: string): Promise<void> {
    for (const id of ids) {
      const row = this.allocations.get(id);
      if (row) this.allocations.set(id, { ...row, deletedAt });
    }
  }

  private labelsOrThrow(): PaymentLabels {
    if (!this.labelsOf) throw new Error('labels not wired');
    return this.labelsOf;
  }

  private allocationView(allocation: PaymentAllocationRecord): PaymentAllocationView {
    const invoice = this.labelsOrThrow().invoice(allocation.invoiceId);
    return {
      id: allocation.id,
      paymentId: allocation.paymentId,
      invoice: {
        type: 'INVOICE',
        id: allocation.invoiceId,
        code: invoice?.code ?? allocation.invoiceId,
        label: invoice?.invoiceNumber ?? allocation.invoiceId,
      },
      invoiceCurrency: invoice?.currency ?? 'USD',
      amountPaymentCurrency: allocation.amountPaymentCurrency,
      amountInvoiceCurrency: allocation.amountInvoiceCurrency,
      amountUsd: allocation.amountUsd,
      createdAt: allocation.createdAt,
    };
  }

  async view(id: string): Promise<PaymentView | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    const labels = this.labelsOrThrow();
    const live = await this.liveAllocations(id);
    return {
      ...row,
      client: labels.client(row.clientId),
      method: labels.method(row.methodId),
      account: labels.account(row.accountId),
      allocated: subMoney(row.allocatable, row.unallocated),
      allocations: live.map((allocation) => this.allocationView(allocation)),
      receipt: row.receiptFileId
        ? {
            id: row.receiptFileId,
            originalName: 'receipt.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
            status: 'READY',
            uploadedById: 'usr_owner',
            createdAt: row.createdAt,
          }
        : null,
    };
  }

  async list(filter: PaymentFilter): Promise<Paginated<PaymentListRowView>> {
    const labels = this.labelsOrThrow();
    const q = filter.q?.toLowerCase();
    const rows = [...this.rows.values()]
      .filter((row) => !filter.status?.length || filter.status.includes(row.status))
      .filter((row) => !filter.clientId?.length || filter.clientId.includes(row.clientId))
      .filter((row) => !filter.accountId?.length || filter.accountId.includes(row.accountId))
      .filter((row) => !filter.methodId?.length || filter.methodId.includes(row.methodId))
      .filter((row) => !filter.currency?.length || filter.currency.includes(row.currency))
      .filter((row) => !filter.dateFrom || row.date >= filter.dateFrom)
      .filter((row) => !filter.dateTo || row.date <= filter.dateTo)
      .filter((row) => !filter.hasUnallocated || Number(row.unallocated) > 0)
      .filter(
        (row) =>
          !q ||
          [row.code, row.reference ?? '', labels.client(row.clientId).label].some((text) =>
            text.toLowerCase().includes(q),
          ),
      )
      .map((row): PaymentListRowView => ({
        id: row.id,
        code: row.code,
        date: row.date,
        client: labels.client(row.clientId),
        method: labels.method(row.methodId),
        account: labels.account(row.accountId),
        currency: row.currency,
        amount: row.amount,
        amountUsd: row.amountUsd,
        allocated: subMoney(row.allocatable, row.unallocated),
        unallocated: row.unallocated,
        reference: row.reference,
        status: row.status,
      }));
    const { field, direction } = filter.sort;
    const sign = direction === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const left = String((a as unknown as Record<string, unknown>)[field] ?? '');
      const right = String((b as unknown as Record<string, unknown>)[field] ?? '');
      return left < right ? -sign : left > right ? sign : 0;
    });
    const start = (filter.page - 1) * filter.pageSize;
    return paginated(rows.slice(start, start + filter.pageSize), rows.length, filter);
  }

  async duplicates(query: DuplicateQuery): Promise<DuplicateMatchView[]> {
    const key = query.reference.trim().toLowerCase();
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.id !== query.excludePaymentId &&
          row.status !== 'ANULADO' &&
          row.methodId === query.methodId &&
          row.accountId === query.accountId &&
          row.reference !== null &&
          row.reference.trim().toLowerCase() === key,
      )
      .map((row) => ({
        payment: { type: 'PAYMENT' as const, id: row.id, code: row.code, label: row.code },
        date: row.date,
        amount: row.amount,
        currency: row.currency,
        status: row.status,
      }));
  }

  async creditRows(clientId: string): Promise<CreditRowView[]> {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.clientId === clientId && row.status === 'CONFIRMADO' && Number(row.unallocated) > 0,
      )
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .map((row) => ({
        paymentId: row.id,
        code: row.code,
        date: row.date,
        currency: row.currency,
        unallocated: row.unallocated,
        usdRate: row.usdRate,
      }));
  }

  async labels(ids: readonly string[]): Promise<Map<string, PaymentLabel>> {
    return new Map(
      ids.flatMap((id) => {
        const row = this.rows.get(id);
        return row ? [[id, { id, code: row.code, clientId: row.clientId }] as const] : [];
      }),
    );
  }

  async hasReceiptFile(fileId: string): Promise<boolean> {
    return [...this.rows.values()].some((row) => row.receiptFileId === fileId);
  }

  /** Σ of the live allocations in the payment currency (a test convenience). */
  liveTotal(paymentId: string): string {
    return sumMoney(
      [...this.allocations.values()]
        .filter((a) => a.paymentId === paymentId && a.deletedAt === null)
        .map((a) => a.amountPaymentCurrency),
    );
  }
}

/** An invoice repository whose live allocations are the payments' own, so a recompute sees them. */
export class LinkedInvoiceRepository extends InMemoryInvoiceRepository {
  constructor(
    uow: InMemoryUnitOfWork,
    private readonly payments: () => InMemoryPaymentRepository,
  ) {
    super(uow);
  }

  override async liveAllocations(invoiceId: string): Promise<InvoiceAllocationState[]> {
    return this.payments().allocationStates(invoiceId);
  }
}
