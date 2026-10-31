import type { DateOnly } from '../../../../src/shared/domain/business-date';
import type { InstallmentStatus, InvoiceStatus } from '../../../../src/shared/domain/enums';
import type { MoneyString } from '../../../../src/shared/domain/money';
import type {
  BillingPlanRecord,
  BillingRepository,
  InstallmentInvoiceState,
  InstallmentPatch,
  InstallmentRecord,
  NewBillingPlan,
  NewInstallment,
  NewRecurringCharge,
  ProjectBillingIds,
  RecurringChargePatch,
  RecurringChargeRecord,
} from '../../../../src/modules/finance/application/ports/billing.repository.port';
import type {
  InMemoryUnitOfWork,
  TransactionParticipant,
} from '../../../support/fakes/in-memory-unit-of-work';

interface State {
  plans: Map<string, BillingPlanRecord>;
  installments: Map<string, InstallmentRecord>;
  charges: Map<string, RecurringChargeRecord>;
}

const copy = (state: State): State => ({
  plans: new Map(state.plans),
  installments: new Map(state.installments),
  charges: new Map(state.charges),
});

const iso = (at: Date) => at.toISOString();

/**
 * Fake `BillingRepository`: rows roll back with the unit of work like the database. An installment is
 * "billed" (locked, with an invoiced amount) when a test calls `bill`, standing in for a live invoice line.
 */
export class InMemoryBillingRepository implements BillingRepository, TransactionParticipant {
  private state: State = { plans: new Map(), installments: new Map(), charges: new Map() };
  private snapshot: State | null = null;
  private readonly invoices = new Map<
    string,
    { status: InvoiceStatus; paidAmount: MoneyString }[]
  >();
  /** Issued invoices naming a project (`hasActiveBilling`). */
  readonly issuedProjects = new Set<string>();

  constructor(uow?: InMemoryUnitOfWork) {
    uow?.enlist(this);
  }

  begin(): void {
    this.snapshot = copy(this.state);
  }

  commit(): void {
    this.snapshot = null;
  }

  rollback(): void {
    if (this.snapshot) this.state = this.snapshot;
    this.snapshot = null;
  }

  // ── test helpers ──
  get installments(): InstallmentRecord[] {
    return [...this.state.installments.values()];
  }

  get charges(): RecurringChargeRecord[] {
    return [...this.state.charges.values()];
  }

  /** Makes a live invoice line reference the installment (locks it). */
  bill(
    installmentId: string,
    amount: MoneyString,
    invoice?: { status: InvoiceStatus; paidAmount: MoneyString },
  ): void {
    const row = this.state.installments.get(installmentId);
    if (!row) throw new Error(`unknown installment ${installmentId}`);
    this.state.installments.set(installmentId, { ...row, locked: true, invoicedAmount: amount });
    this.invoices.set(installmentId, [
      ...(this.invoices.get(installmentId) ?? []),
      invoice ?? { status: 'EMITIDA', paidAmount: '0.00' },
    ]);
  }

  /** The invoice is voided: it no longer binds the installment. */
  release(installmentId: string): void {
    const row = this.state.installments.get(installmentId);
    if (!row) throw new Error(`unknown installment ${installmentId}`);
    this.state.installments.set(installmentId, { ...row, locked: false, invoicedAmount: '0.00' });
    this.invoices.delete(installmentId);
  }

  // ── BillingRepository ──
  async findPlan(projectId: string): Promise<BillingPlanRecord | null> {
    return [...this.state.plans.values()].find((plan) => plan.projectId === projectId) ?? null;
  }

  async savePlan(plan: NewBillingPlan, at: Date): Promise<BillingPlanRecord> {
    const existing = this.state.plans.get(plan.id);
    const saved: BillingPlanRecord = {
      ...plan,
      createdAt: existing?.createdAt ?? iso(at),
      updatedAt: iso(at),
    };
    this.state.plans.set(plan.id, saved);
    return saved;
  }

  async listInstallments(projectId: string): Promise<InstallmentRecord[]> {
    return this.installments
      .filter((row) => row.projectId === projectId)
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }

  async findInstallment(id: string): Promise<InstallmentRecord | null> {
    return this.state.installments.get(id) ?? null;
  }

  async maxInstallmentOrder(projectId: string): Promise<number> {
    return this.installments
      .filter((row) => row.projectId === projectId)
      .reduce((max, row) => Math.max(max, row.order), -1);
  }

  async insertInstallments(rows: readonly NewInstallment[]): Promise<void> {
    for (const row of rows) {
      this.state.installments.set(row.id, {
        ...row,
        status: 'PENDIENTE',
        cancelledAt: null,
        invoicedAmount: '0.00',
        locked: false,
      });
    }
  }

  async insertGeneratedInstallments(rows: readonly NewInstallment[]): Promise<DateOnly[]> {
    const inserted: DateOnly[] = [];
    for (const row of rows) {
      const taken = this.installments.some(
        (item) =>
          item.recurringChargeId === row.recurringChargeId && item.periodStart === row.periodStart,
      );
      if (taken) continue;
      await this.insertInstallments([row]);
      if (row.periodStart) inserted.push(row.periodStart);
    }
    return inserted;
  }

  async updateInstallment(id: string, patch: InstallmentPatch): Promise<void> {
    const row = this.state.installments.get(id);
    if (!row) throw new Error(`unknown installment ${id}`);
    const next = { ...row };
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) Object.assign(next, { [key]: value });
    }
    this.state.installments.set(id, next);
  }

  async cancelInstallments(ids: readonly string[], at: Date): Promise<void> {
    for (const id of ids) {
      const row = this.state.installments.get(id);
      if (row)
        this.state.installments.set(id, { ...row, cancelledAt: iso(at), status: 'CANCELADA' });
    }
  }

  async installmentInvoiceStates(ids: readonly string[]): Promise<InstallmentInvoiceState[]> {
    return ids.flatMap((id) => {
      const row = this.state.installments.get(id);
      return row
        ? [
            {
              id,
              status: row.status,
              cancelled: row.cancelledAt !== null,
              invoices: this.invoices.get(id) ?? [],
            },
          ]
        : [];
    });
  }

  async setInstallmentStatus(id: string, status: InstallmentStatus): Promise<void> {
    const row = this.state.installments.get(id);
    if (row) this.state.installments.set(id, { ...row, status });
  }

  async periodStartsOf(recurringChargeId: string): Promise<DateOnly[]> {
    return this.installments
      .filter((row) => row.recurringChargeId === recurringChargeId && row.periodStart !== null)
      .map((row) => row.periodStart as DateOnly)
      .sort();
  }

  async listCharges(projectId: string): Promise<RecurringChargeRecord[]> {
    return this.charges.filter((row) => row.projectId === projectId);
  }

  async findCharge(id: string): Promise<RecurringChargeRecord | null> {
    return this.state.charges.get(id) ?? null;
  }

  async insertCharge(row: NewRecurringCharge, at: Date): Promise<void> {
    this.state.charges.set(row.id, { ...row, createdAt: iso(at), updatedAt: iso(at) });
  }

  async updateCharge(id: string, patch: RecurringChargePatch, at: Date): Promise<void> {
    const row = this.state.charges.get(id);
    if (!row) throw new Error(`unknown charge ${id}`);
    const next = { ...row, updatedAt: iso(at) };
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) Object.assign(next, { [key]: value });
    }
    this.state.charges.set(id, next);
  }

  async activeChargeIds(): Promise<string[]> {
    return this.charges
      .filter((row) => row.status === 'ACTIVO')
      .map((row) => row.id)
      .sort();
  }

  async hasActiveBilling(projectId: string): Promise<boolean> {
    return (
      this.installments.some(
        (row) =>
          row.projectId === projectId && row.status !== 'CANCELADA' && row.status !== 'COBRADA',
      ) ||
      this.charges.some((row) => row.projectId === projectId && row.status !== 'FINALIZADO') ||
      this.issuedProjects.has(projectId)
    );
  }

  async hasActiveCharge(projectId: string): Promise<boolean> {
    return this.charges.some((row) => row.projectId === projectId && row.status !== 'FINALIZADO');
  }

  async billingIdsOf(projectId: string): Promise<ProjectBillingIds> {
    return {
      billingPlanIds: [...this.state.plans.values()]
        .filter((p) => p.projectId === projectId)
        .map((p) => p.id),
      installmentIds: this.installments.filter((i) => i.projectId === projectId).map((i) => i.id),
      recurringChargeIds: this.charges.filter((c) => c.projectId === projectId).map((c) => c.id),
    };
  }
}
