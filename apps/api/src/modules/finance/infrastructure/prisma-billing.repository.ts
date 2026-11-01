import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import type { DateOnly } from '../../../shared/domain/business-date';
import { roundMoney, sumMoney } from '../../../shared/domain/money';
import {
  dateOnlyToDbDate,
  dbDateToDateOnly,
  decimalToString,
  stringToDecimal,
} from '../../../shared/infrastructure/prisma/decimal-mapper';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
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
} from '../application/ports/billing.repository.port';
import type { InstallmentStatus } from '../../../shared/domain/enums';

type PlanRow = Prisma.BillingPlanGetPayload<object>;
type InstallmentRow = Prisma.BillingInstallmentGetPayload<object>;
type ChargeRow = Prisma.RecurringChargeGetPayload<object>;

const dec = stringToDecimal;
/** Money columns leave with two decimals, like every computed amount (`"4000.00"`). */
const money = (value: Prisma.Decimal) => roundMoney(decimalToString(value));
const optionalDec = (value: string | null | undefined) =>
  value === null || value === undefined ? null : dec(value);
const optionalDate = (value: string | null | undefined) =>
  value === null || value === undefined ? null : dateOnlyToDbDate(value);

/** An invoice that still binds an installment: not voided and not archived. */
const LIVE_INVOICE = { deletedAt: null, voidedAt: null, status: { not: 'ANULADA' } } as const;

function toPlan(row: PlanRow): BillingPlanRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    model: row.model,
    currency: row.currency,
    contractAmount: row.contractAmount === null ? null : money(row.contractAmount),
    contractedUsd: row.contractedUsd === null ? null : money(row.contractedUsd),
    usdRate: row.usdRate === null ? null : decimalToString(row.usdRate),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toCharge(row: ChargeRow): RecurringChargeRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    label: row.label,
    amount: money(row.amount),
    currency: row.currency,
    frequency: row.frequency,
    startDate: dbDateToDateOnly(row.startDate),
    endDate: row.endDate === null ? null : dbDateToDateOnly(row.endDate),
    billingDay: row.billingDay,
    leadDays: row.leadDays,
    status: row.status,
    lastGeneratedPeriodStart:
      row.lastGeneratedPeriodStart === null ? null : dbDateToDateOnly(row.lastGeneratedPeriodStart),
    resumedOn: row.resumedOn === null ? null : dbDateToDateOnly(row.resumedOn),
    usdRate: decimalToString(row.usdRate),
    monthlyAmountUsd: money(row.monthlyAmountUsd),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function installmentData(row: NewInstallment): Prisma.BillingInstallmentUncheckedCreateInput {
  return {
    id: row.id,
    projectId: row.projectId,
    billingPlanId: row.billingPlanId,
    recurringChargeId: row.recurringChargeId,
    kind: row.kind,
    label: row.label,
    amount: dec(row.amount),
    currency: row.currency,
    percentage: optionalDec(row.percentage),
    dueDate: optionalDate(row.dueDate),
    trigger: row.trigger,
    periodStart: optionalDate(row.periodStart),
    periodEnd: optionalDate(row.periodEnd),
    order: row.order,
  };
}

/**
 * Billing tables through the current transaction (or the base client outside a unit of work). Reads of the
 * invoices that bind an installment are explicit about `deletedAt` (relation filters are not covered by the
 * soft-delete extension). The callers hold the row locks of the global lock order, so no method locks.
 */
@Injectable()
export class PrismaBillingRepository implements BillingRepository {
  constructor(@Inject(TransactionHost) private readonly host: TransactionHost) {}

  async findPlan(projectId: string): Promise<BillingPlanRecord | null> {
    const row = await this.host.db.billingPlan.findUnique({ where: { projectId } });
    return row && toPlan(row);
  }

  async savePlan(plan: NewBillingPlan, at: Date): Promise<BillingPlanRecord> {
    const data = {
      model: plan.model,
      currency: plan.currency,
      contractAmount: optionalDec(plan.contractAmount),
      contractedUsd: optionalDec(plan.contractedUsd),
      usdRate: optionalDec(plan.usdRate),
      notes: plan.notes,
      updatedAt: at,
    };
    const row = await this.host.db.billingPlan.upsert({
      where: { id: plan.id },
      create: { id: plan.id, projectId: plan.projectId, createdAt: at, ...data },
      update: data,
    });
    return toPlan(row);
  }

  async listInstallments(projectId: string): Promise<InstallmentRecord[]> {
    const rows = await this.host.db.billingInstallment.findMany({
      where: { projectId },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
    });
    return this.decorate(rows);
  }

  async findInstallment(id: string): Promise<InstallmentRecord | null> {
    const row = await this.host.db.billingInstallment.findUnique({ where: { id } });
    return row ? ((await this.decorate([row]))[0] ?? null) : null;
  }

  async maxInstallmentOrder(projectId: string): Promise<number> {
    const result = await this.host.db.billingInstallment.aggregate({
      where: { projectId },
      _max: { order: true },
    });
    return result._max.order ?? -1;
  }

  async insertInstallments(rows: readonly NewInstallment[]): Promise<void> {
    if (rows.length === 0) return;
    await this.host.db.billingInstallment.createMany({ data: rows.map(installmentData) });
  }

  async insertGeneratedInstallments(rows: readonly NewInstallment[]): Promise<DateOnly[]> {
    if (rows.length === 0) return [];
    await this.host.db.billingInstallment.createMany({
      data: rows.map(installmentData),
      skipDuplicates: true,
    });
    const stored = await this.host.db.billingInstallment.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
      select: { periodStart: true },
    });
    return stored.flatMap((row) => (row.periodStart ? [dbDateToDateOnly(row.periodStart)] : []));
  }

  async updateInstallment(id: string, patch: InstallmentPatch, at: Date): Promise<void> {
    await this.host.db.billingInstallment.update({
      where: { id },
      data: {
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.amount !== undefined ? { amount: dec(patch.amount) } : {}),
        ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
        ...(patch.percentage !== undefined ? { percentage: optionalDec(patch.percentage) } : {}),
        ...(patch.dueDate !== undefined ? { dueDate: optionalDate(patch.dueDate) } : {}),
        ...(patch.trigger !== undefined ? { trigger: patch.trigger } : {}),
        ...(patch.order !== undefined ? { order: patch.order } : {}),
        updatedAt: at,
      },
    });
  }

  async cancelInstallments(ids: readonly string[], at: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.host.db.billingInstallment.updateMany({
      where: { id: { in: [...ids] } },
      data: { cancelledAt: at, status: 'CANCELADA', updatedAt: at },
    });
  }

  async installmentInvoiceStates(ids: readonly string[]): Promise<InstallmentInvoiceState[]> {
    const states: InstallmentInvoiceState[] = [];
    for (const id of ids) {
      const row = await this.host.db.billingInstallment.findUnique({ where: { id } });
      if (!row) continue;
      const invoices = await this.host.db.invoice.findMany({
        where: { deletedAt: null, lines: { some: { installmentId: id } } },
        select: { status: true, paidAmount: true },
      });
      states.push({
        id,
        status: row.status,
        cancelled: row.cancelledAt !== null,
        invoices: invoices.map((invoice) => ({
          status: invoice.status,
          paidAmount: money(invoice.paidAmount),
        })),
      });
    }
    return states;
  }

  async setInstallmentStatus(id: string, status: InstallmentStatus): Promise<void> {
    await this.host.db.billingInstallment.update({ where: { id }, data: { status } });
  }

  async periodStartsOf(recurringChargeId: string): Promise<DateOnly[]> {
    const rows = await this.host.db.billingInstallment.findMany({
      where: { recurringChargeId, periodStart: { not: null } },
      select: { periodStart: true },
      orderBy: { periodStart: 'asc' },
    });
    return rows.flatMap((row) => (row.periodStart ? [dbDateToDateOnly(row.periodStart)] : []));
  }

  async listCharges(projectId: string): Promise<RecurringChargeRecord[]> {
    const rows = await this.host.db.recurringCharge.findMany({
      where: { projectId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toCharge);
  }

  async findCharge(id: string): Promise<RecurringChargeRecord | null> {
    const row = await this.host.db.recurringCharge.findUnique({ where: { id } });
    return row && toCharge(row);
  }

  async insertCharge(row: NewRecurringCharge, at: Date): Promise<void> {
    await this.host.db.recurringCharge.create({
      data: {
        id: row.id,
        projectId: row.projectId,
        label: row.label,
        amount: dec(row.amount),
        currency: row.currency,
        frequency: row.frequency,
        startDate: dateOnlyToDbDate(row.startDate),
        endDate: optionalDate(row.endDate),
        billingDay: row.billingDay,
        leadDays: row.leadDays,
        status: row.status,
        lastGeneratedPeriodStart: optionalDate(row.lastGeneratedPeriodStart),
        resumedOn: optionalDate(row.resumedOn),
        usdRate: dec(row.usdRate),
        monthlyAmountUsd: dec(row.monthlyAmountUsd),
        createdAt: at,
        updatedAt: at,
      },
    });
  }

  async updateCharge(id: string, patch: RecurringChargePatch, at: Date): Promise<void> {
    await this.host.db.recurringCharge.update({
      where: { id },
      data: {
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.amount !== undefined ? { amount: dec(patch.amount) } : {}),
        ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
        ...(patch.frequency !== undefined ? { frequency: patch.frequency } : {}),
        ...(patch.startDate !== undefined ? { startDate: dateOnlyToDbDate(patch.startDate) } : {}),
        ...(patch.endDate !== undefined ? { endDate: optionalDate(patch.endDate) } : {}),
        ...(patch.billingDay !== undefined ? { billingDay: patch.billingDay } : {}),
        ...(patch.leadDays !== undefined ? { leadDays: patch.leadDays } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.lastGeneratedPeriodStart !== undefined
          ? { lastGeneratedPeriodStart: optionalDate(patch.lastGeneratedPeriodStart) }
          : {}),
        ...(patch.resumedOn !== undefined ? { resumedOn: optionalDate(patch.resumedOn) } : {}),
        ...(patch.usdRate !== undefined ? { usdRate: dec(patch.usdRate) } : {}),
        ...(patch.monthlyAmountUsd !== undefined
          ? { monthlyAmountUsd: dec(patch.monthlyAmountUsd) }
          : {}),
        updatedAt: at,
      },
    });
  }

  async activeChargeIds(): Promise<string[]> {
    const rows = await this.host.db.recurringCharge.findMany({
      where: { status: 'ACTIVO' },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => row.id);
  }

  async hasActiveBilling(projectId: string): Promise<boolean> {
    const db = this.host.db;
    const openInstallment = await db.billingInstallment.count({
      where: { projectId, status: { notIn: ['CANCELADA', 'COBRADA'] } },
    });
    if (openInstallment > 0) return true;
    const liveCharge = await db.recurringCharge.count({
      where: { projectId, status: { not: 'FINALIZADO' } },
    });
    if (liveCharge > 0) return true;
    const issued = await db.invoiceLine.count({
      where: {
        projectId,
        invoice: { deletedAt: null, status: { notIn: ['ANULADA', 'BORRADOR'] } },
      },
    });
    return issued > 0;
  }

  async hasActiveCharge(projectId: string): Promise<boolean> {
    return (
      (await this.host.db.recurringCharge.count({
        where: { projectId, status: { not: 'FINALIZADO' } },
      })) > 0
    );
  }

  async billingIdsOf(projectId: string): Promise<ProjectBillingIds> {
    const db = this.host.db;
    const [plans, installments, charges] = [
      await db.billingPlan.findMany({ where: { projectId }, select: { id: true } }),
      await db.billingInstallment.findMany({ where: { projectId }, select: { id: true } }),
      await db.recurringCharge.findMany({ where: { projectId }, select: { id: true } }),
    ];
    return {
      billingPlanIds: plans.map((row) => row.id),
      installmentIds: installments.map((row) => row.id),
      recurringChargeIds: charges.map((row) => row.id),
    };
  }

  /** Adds `invoicedAmount` and `locked`, derived from the live invoice lines that reference each row. */
  private async decorate(rows: readonly InstallmentRow[]): Promise<InstallmentRecord[]> {
    if (rows.length === 0) return [];
    const lines = await this.host.db.invoiceLine.findMany({
      where: { installmentId: { in: rows.map((row) => row.id) }, invoice: LIVE_INVOICE },
      select: { installmentId: true, netAmount: true },
    });
    const byInstallment = new Map<string, string[]>();
    for (const line of lines) {
      if (line.installmentId === null) continue;
      byInstallment.set(line.installmentId, [
        ...(byInstallment.get(line.installmentId) ?? []),
        money(line.netAmount),
      ]);
    }
    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      billingPlanId: row.billingPlanId,
      recurringChargeId: row.recurringChargeId,
      kind: row.kind,
      label: row.label,
      amount: money(row.amount),
      currency: row.currency,
      percentage: row.percentage === null ? null : decimalToString(row.percentage),
      dueDate: row.dueDate === null ? null : dbDateToDateOnly(row.dueDate),
      trigger: row.trigger,
      periodStart: row.periodStart === null ? null : dbDateToDateOnly(row.periodStart),
      periodEnd: row.periodEnd === null ? null : dbDateToDateOnly(row.periodEnd),
      order: row.order,
      status: row.status,
      cancelledAt: row.cancelledAt === null ? null : row.cancelledAt.toISOString(),
      invoicedAmount: sumMoney(byInstallment.get(row.id) ?? []),
      locked: byInstallment.has(row.id),
    }));
  }
}
