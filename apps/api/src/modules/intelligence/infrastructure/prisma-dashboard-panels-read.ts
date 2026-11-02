import { Injectable } from '@nestjs/common';
import { parseDateOnly, type DateOnly } from '../../../shared/domain/business-date';
import type { EntityRef } from '../../../shared/domain/entity-ref';
import { compareMoney, subMoney, toUsd } from '../../../shared/domain/money';
import type { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import {
  dbDateToDateOnly,
  decimalToString,
} from '../../../shared/infrastructure/prisma/decimal-mapper';
import type {
  AccountBalanceRow,
  ClientMetricsRecord,
  DashboardPanelsReadPort,
  DueInvoiceRow,
  ExpiringDocumentRow,
  InstallmentDueRow,
  ProjectMetricsRecord,
  RecentActivityRow,
  RecurringChargeRow,
  UpcomingRecurringExpenseRow,
} from '../application/ports/dashboard-panels-read.port';
import { computeProjectMargin } from '../../finance/application/kpi-api';

const ZERO = '0.00';
/** Money columns are `Decimal(18,2)`; the string never passes through a JS number (C15). */
const money = (value: Prisma.Decimal | undefined): string => (value ? value.toFixed(2) : ZERO);
const ref = (type: EntityRef['type'], id: string, label: string, code?: string): EntityRef =>
  code === undefined ? { type, id, label } : { type, id, code, label };

/**
 * Rows for the dashboard panels and the entity summaries (PRD §8.1, §8.4.4), over the partial indexes of
 * data-rules §3b (`inv_open`, `inst_pending`, `doc_expiring`, `exp_recurring_pending`). The soft-delete
 * extension hides archived rows from every `findMany`; `findUnique` reads (the summaries) report `archived`
 * instead. Reads only.
 */
@Injectable()
export class PrismaDashboardPanelsRead implements DashboardPanelsReadPort {
  constructor(private readonly tx: TransactionHost) {}

  async invoicesDue(limit: number): Promise<DueInvoiceRow[]> {
    const rows = await this.tx.db.invoice.findMany({
      where: {
        status: { in: ['EMITIDA', 'PARCIAL', 'VENCIDA'] },
        isDraft: false,
        balance: { gt: 0 },
      },
      select: {
        id: true,
        code: true,
        invoiceNumber: true,
        dueDate: true,
        currency: true,
        balance: true,
        usdRate: true,
        client: { select: { id: true, code: true, tradeName: true } },
      },
      orderBy: [{ dueDate: 'asc' }, { code: 'asc' }],
      take: limit,
    });
    return rows.map((row) => {
      const balanceUsd = toUsd(money(row.balance), decimalToString(row.usdRate));
      return {
        invoice: ref('INVOICE', row.id, row.invoiceNumber, row.code),
        client: ref('CLIENT', row.client.id, row.client.tradeName, row.client.code),
        dueDate: dbDateToDateOnly(row.dueDate),
        currency: row.currency,
        balance: money(row.balance),
        balanceUsd: compareMoney(balanceUsd, ZERO) > 0 ? balanceUsd : ZERO,
      };
    });
  }

  async installmentsToInvoice(until: DateOnly): Promise<InstallmentDueRow[]> {
    const rows = await this.tx.db.billingInstallment.findMany({
      where: {
        status: 'PENDIENTE',
        dueDate: { not: null, lte: parseDateOnly(until) },
        project: { deletedAt: null },
      },
      select: {
        id: true,
        label: true,
        amount: true,
        currency: true,
        dueDate: true,
        project: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ dueDate: 'asc' }, { order: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      installment: ref('INSTALLMENT', row.id, row.label),
      project: ref('PROJECT', row.project.id, row.project.name, row.project.code),
      amount: money(row.amount),
      currency: row.currency,
      dueDate: row.dueDate === null ? null : dbDateToDateOnly(row.dueDate),
    }));
  }

  async documentsExpiring(from: DateOnly, until: DateOnly): Promise<ExpiringDocumentRow[]> {
    const rows = await this.tx.db.document.findMany({
      where: {
        status: { notIn: ['ANULADO', 'VENCIDO'] },
        expiresAt: { gte: parseDateOnly(from), lte: parseDateOnly(until) },
      },
      select: { id: true, code: true, title: true, expiresAt: true },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
    });
    return rows.flatMap((row) =>
      row.expiresAt === null
        ? []
        : [
            {
              document: ref('DOCUMENT', row.id, row.title, row.code),
              expiresAt: dbDateToDateOnly(row.expiresAt),
            },
          ],
    );
  }

  async upcomingRecurringExpenses(until: DateOnly): Promise<UpcomingRecurringExpenseRow[]> {
    const rows = await this.tx.db.expense.findMany({
      where: {
        status: 'PENDIENTE',
        recurringExpenseId: { not: null },
        dueDate: { not: null, lte: parseDateOnly(until) },
      },
      select: {
        id: true,
        code: true,
        description: true,
        dueDate: true,
        amount: true,
        currency: true,
        amountUsd: true,
      },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    });
    return rows.flatMap((row) =>
      row.dueDate === null
        ? []
        : [
            {
              expense: ref('EXPENSE', row.id, row.description, row.code),
              dueDate: dbDateToDateOnly(row.dueDate),
              amount: money(row.amount),
              currency: row.currency,
              amountUsd: money(row.amountUsd),
            },
          ],
    );
  }

  async recentActivity(limit: number): Promise<RecentActivityRow[]> {
    const rows = await this.tx.db.activityLog.findMany({
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        entityLabel: true,
        createdAt: true,
        actor: { select: { name: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      entity: ref(row.entityType, row.entityId, row.entityLabel),
      actorName: row.actor?.name ?? null,
      createdAt: row.createdAt,
    }));
  }

  async recurringChargesAt(date: DateOnly): Promise<RecurringChargeRow[]> {
    const day = parseDateOnly(date);
    const rows = await this.tx.db.recurringCharge.findMany({
      where: {
        startDate: { lte: day },
        OR: [{ endDate: null }, { endDate: { gte: day } }],
        project: { deletedAt: null },
      },
      select: { monthlyAmountUsd: true, status: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => ({
      monthlyAmountUsd: money(row.monthlyAmountUsd),
      status: row.status,
    }));
  }

  async activeAccountBalances(): Promise<AccountBalanceRow[]> {
    const rows = await this.tx.db.account.findMany({
      where: { active: true },
      select: { currency: true, balance: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => ({ currency: row.currency, balance: money(row.balance) }));
  }

  async clientMetrics(clientId: string): Promise<ClientMetricsRecord | null> {
    const row = await this.tx.db.client.findUnique({
      where: { id: clientId },
      include: { metrics: true },
    });
    if (!row) return null;
    const m = row.metrics;
    return {
      archived: row.deletedAt !== null,
      metrics: {
        clientId: row.id,
        code: row.code,
        tradeName: row.tradeName,
        status: row.status,
        invoicedUsd: money(m?.invoicedUsd),
        collectedUsd: money(m?.collectedUsd),
        receivableUsd: money(m?.receivableUsd),
        overdueUsd: money(m?.overdueUsd),
        creditUsd: money(m?.creditUsd),
        projectCount: m?.projectCount ?? 0,
        lastActivityAt: m?.lastActivityAt ?? null,
      },
    };
  }

  async projectMetrics(projectId: string): Promise<ProjectMetricsRecord | null> {
    const row = await this.tx.db.project.findUnique({
      where: { id: projectId },
      include: { metrics: true, billingPlan: { select: { model: true } } },
    });
    if (!row) return null;
    const m = row.metrics;
    const marginUsd = money(m?.marginUsd);
    const collectedUsd = money(m?.collectedUsd);
    return {
      archived: row.deletedAt !== null,
      model: row.billingPlan?.model ?? null,
      metrics: {
        projectId: row.id,
        code: row.code,
        name: row.name,
        status: row.status,
        contractedUsd: money(m?.contractedUsd),
        invoicedUsd: money(m?.invoicedUsd),
        collectedUsd,
        toInvoiceUsd: money(m?.toInvoiceUsd),
        receivableUsd: money(m?.receivableUsd),
        expensesUsd: money(m?.expensesUsd),
        marginUsd,
        monthlyRecurringUsd: money(m?.monthlyRecurringUsd),
        marginPercent: computeProjectMargin({
          collectedUsd,
          allocatedExpensesUsd: subMoney(collectedUsd, marginUsd),
        }),
      },
    };
  }
}
