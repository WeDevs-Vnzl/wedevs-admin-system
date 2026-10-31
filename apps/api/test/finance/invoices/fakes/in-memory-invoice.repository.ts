import type {
  BillableInstallmentView,
  InstallmentRef,
  InvoiceAllocationState,
  InvoiceFilter,
  InvoiceLabel,
  InvoiceListRowView,
  InvoiceRecord,
  InvoiceRepository,
  InvoiceView,
  OpenInvoiceView,
} from '../../../../src/modules/finance/application/ports/invoice.repository.port';
import { ConflictError } from '../../../../src/shared/domain/domain-error';
import { addMoney } from '../../../../src/shared/domain/money';
import { paginated, type Paginated } from '../../../../src/shared/domain/pagination';
import type {
  InMemoryUnitOfWork,
  TransactionParticipant,
} from '../../../support/fakes/in-memory-unit-of-work';

const OPEN = ['EMITIDA', 'PARCIAL', 'VENCIDA'];

/** Fake `InvoiceRepository`: rows roll back with the unit of work like the database. */
export class InMemoryInvoiceRepository implements InvoiceRepository, TransactionParticipant {
  private rows = new Map<string, InvoiceRecord>();
  private snapshot: Map<string, InvoiceRecord> | null = null;
  private readonly installmentRows = new Map<string, InstallmentRef>();
  private readonly allocations = new Map<string, InvoiceAllocationState[]>();
  private readonly pending: BillableInstallmentView[] = [];

  constructor(uow?: InMemoryUnitOfWork) {
    uow?.enlist(this);
  }

  get all(): readonly InvoiceRecord[] {
    return [...this.rows.values()];
  }

  seed(record: InvoiceRecord): void {
    this.rows.set(record.id, record);
  }

  seedInstallment(ref: InstallmentRef): void {
    this.installmentRows.set(ref.id, ref);
  }

  seedAllocation(invoiceId: string, state: InvoiceAllocationState): void {
    this.allocations.set(invoiceId, [...(this.allocations.get(invoiceId) ?? []), state]);
  }

  seedBillable(view: BillableInstallmentView): void {
    this.pending.push(view);
  }

  begin(): void {
    this.snapshot = new Map(this.rows);
  }

  commit(): void {
    this.snapshot = null;
  }

  rollback(): void {
    if (this.snapshot) this.rows = this.snapshot;
    this.snapshot = null;
  }

  async findById(id: string): Promise<InvoiceRecord | null> {
    return this.rows.get(id) ?? null;
  }

  private assertNumberFree(record: InvoiceRecord): void {
    const wanted = record.invoiceNumber.trim().toLowerCase();
    for (const row of this.rows.values()) {
      if (
        row.id !== record.id &&
        row.archivedAt === null &&
        row.invoiceNumber.trim().toLowerCase() === wanted
      ) {
        throw new ConflictError({
          fieldErrors: { invoiceNumber: ['invoices.errors.numberTaken'] },
        });
      }
    }
  }

  async insert(record: InvoiceRecord): Promise<void> {
    this.assertNumberFree(record);
    this.rows.set(record.id, record);
  }

  async update(record: InvoiceRecord): Promise<void> {
    if (record.archivedAt === null) this.assertNumberFree(record);
    this.rows.set(record.id, record);
  }

  async numberHolder(invoiceNumber: string, exceptId: string | null): Promise<InvoiceLabel | null> {
    const wanted = invoiceNumber.trim().toLowerCase();
    const holder = [...this.rows.values()].find(
      (row) =>
        row.id !== exceptId &&
        row.archivedAt === null &&
        row.invoiceNumber.trim().toLowerCase() === wanted,
    );
    return holder ? labelOf(holder) : null;
  }

  async liveAllocations(invoiceId: string): Promise<InvoiceAllocationState[]> {
    return (this.allocations.get(invoiceId) ?? []).filter(
      (allocation) => allocation.paymentStatus !== 'ANULADO',
    );
  }

  async installments(ids: readonly string[]): Promise<InstallmentRef[]> {
    return ids.flatMap((id) => {
      const ref = this.installmentRows.get(id);
      return ref ? [ref] : [];
    });
  }

  async billedAmounts(installmentIds: readonly string[], exceptInvoiceId: string | null) {
    const result = new Map<string, string>();
    for (const row of this.rows.values()) {
      if (row.id === exceptInvoiceId || row.archivedAt !== null || row.voidedAt !== null) continue;
      for (const line of row.lines) {
        if (line.installmentId === null || !installmentIds.includes(line.installmentId)) continue;
        result.set(
          line.installmentId,
          addMoney(result.get(line.installmentId) ?? '0', line.netAmount),
        );
      }
    }
    return result;
  }

  async view(id: string): Promise<InvoiceView | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    return {
      ...row,
      client: { type: 'CLIENT', id: row.clientId, label: row.clientId },
      lines: row.lines.map((line) => ({
        ...line,
        project: line.projectId
          ? { type: 'PROJECT' as const, id: line.projectId, label: line.projectId }
          : null,
        installment: line.installmentId
          ? { type: 'INSTALLMENT' as const, id: line.installmentId, label: line.installmentId }
          : null,
      })),
      file: row.fileId
        ? {
            id: row.fileId,
            originalName: 'factura.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1,
            status: 'READY',
            uploadedById: 'usr_owner',
            createdAt: row.createdAt,
          }
        : null,
      allocations: [],
    };
  }

  async list(filter: InvoiceFilter): Promise<Paginated<InvoiceListRowView>> {
    const rows = [...this.rows.values()]
      .filter((row) => (filter.archived === 'only' ? row.archivedAt !== null : true))
      .filter((row) => (filter.archived === 'exclude' ? row.archivedAt === null : true))
      .filter((row) => !filter.status?.length || filter.status.includes(row.status))
      .filter((row) => !filter.clientId?.length || filter.clientId.includes(row.clientId))
      .filter((row) => !filter.currency?.length || filter.currency.includes(row.currency))
      .filter(
        (row) =>
          !filter.projectId?.length ||
          row.lines.some((line) => line.projectId && filter.projectId?.includes(line.projectId)),
      )
      .filter((row) => !filter.dateFrom || row.issueDate >= filter.dateFrom)
      .filter((row) => !filter.dateTo || row.issueDate <= filter.dateTo)
      .filter(
        (row) =>
          !filter.q ||
          [row.code, row.invoiceNumber].some((text) =>
            text.toLowerCase().includes((filter.q as string).toLowerCase()),
          ),
      )
      .map((row): InvoiceListRowView => ({
        id: row.id,
        code: row.code,
        invoiceNumber: row.invoiceNumber,
        client: { type: 'CLIENT', id: row.clientId, label: row.clientId },
        projects: [],
        issueDate: row.issueDate,
        dueDate: row.dueDate,
        currency: row.currency,
        total: row.total,
        balance: row.balance,
        totalUsd: row.totalUsd,
        balanceUsd: row.balance,
        status: row.status,
        paidAmount: row.paidAmount,
        archivedAt: row.archivedAt,
      }));
    return paginated(rows, rows.length, filter);
  }

  async billableInstallments(projectIds: readonly string[]): Promise<BillableInstallmentView[]> {
    return this.pending.filter((view) => projectIds.includes(view.project.id));
  }

  async openInvoices(clientId: string): Promise<OpenInvoiceView[]> {
    return [...this.rows.values()]
      .filter(
        (row) => row.clientId === clientId && row.archivedAt === null && OPEN.includes(row.status),
      )
      .map((row) => ({
        id: row.id,
        code: row.code,
        invoiceNumber: row.invoiceNumber,
        issueDate: row.issueDate,
        dueDate: row.dueDate,
        currency: row.currency,
        usdRate: row.usdRate,
        receivable: row.receivable,
        balance: row.balance,
        status: row.status,
      }));
  }

  async overdueIds(today: string): Promise<string[]> {
    return [...this.rows.values()]
      .filter(
        (row) => !row.isDraft && ['EMITIDA', 'PARCIAL'].includes(row.status) && row.dueDate < today,
      )
      .map((row) => row.id);
  }

  async labels(ids: readonly string[]): Promise<Map<string, InvoiceLabel>> {
    return new Map(
      ids.flatMap((id) => {
        const row = this.rows.get(id);
        return row ? [[id, labelOf(row)] as const] : [];
      }),
    );
  }

  async hasFile(fileId: string): Promise<boolean> {
    return [...this.rows.values()].some((row) => row.fileId === fileId);
  }
}

function labelOf(row: InvoiceRecord): InvoiceLabel {
  return {
    id: row.id,
    code: row.code,
    invoiceNumber: row.invoiceNumber,
    clientId: row.clientId,
    archived: row.archivedAt !== null,
  };
}
