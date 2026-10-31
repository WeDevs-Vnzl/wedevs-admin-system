import { Injectable } from '@nestjs/common';
import type {
  ClientMoneyColumns,
  FactRow,
  InvoiceCacheWrite,
  ProjectMoneyColumns,
  ReadModelWriterPort,
} from '../application/ports/read-model-writer.port';
import type { InstallmentStatus } from '../../../shared/domain/enums';
import type { MoneyString } from '../../../shared/domain/money';
import {
  dateOnlyToDbDate,
  stringToDecimal as dec,
} from '../../../shared/infrastructure/prisma/decimal-mapper';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { FinanceFactSource } from '../domain/finance-fact';

/**
 * Writes the finance read models and caches in the current transaction. Metrics rows are locked
 * ascending by `id COLLATE "C"` (the order of the global lock order for `ClientMetrics` then
 * `ProjectMetrics`), and the money upserts never name `projectCount` or `lastActivityAt` (DT-111).
 */
@Injectable()
export class PrismaReadModelWriter implements ReadModelWriterPort {
  constructor(private readonly host: TransactionHost) {}

  async replaceFacts(
    sourceType: FinanceFactSource,
    sourceId: string,
    facts: readonly FactRow[],
  ): Promise<void> {
    const tx = this.host.requireTransaction('ReadModelWriterPort.replaceFacts');
    await tx.financeFact.deleteMany({ where: { sourceType, sourceId } });
    if (facts.length === 0) return;
    await tx.financeFact.createMany({
      data: facts.map((fact) => ({
        kind: fact.kind,
        date: dateOnlyToDbDate(fact.date),
        amountUsd: dec(fact.amountUsd),
        clientId: fact.clientId ?? null,
        projectId: fact.projectId ?? null,
        accountId: fact.accountId ?? null,
        categoryId: fact.categoryId ?? null,
        methodId: fact.methodId ?? null,
        invoiceId: fact.invoiceId ?? null,
        ivaRate: fact.ivaRate == null ? null : dec(fact.ivaRate),
        dueDate: fact.dueDate == null ? null : dateOnlyToDbDate(fact.dueDate),
        sourceType,
        sourceId,
      })),
    });
  }

  async clearFacts(): Promise<void> {
    const tx = this.host.requireTransaction('ReadModelWriterPort.clearFacts');
    await tx.financeFact.deleteMany({});
  }

  async lockClientMetrics(clientIds: readonly string[]): Promise<void> {
    const tx = this.host.requireTransaction('ReadModelWriterPort.lockClientMetrics');
    const ids = [...new Set(clientIds)];
    if (ids.length === 0) return;
    // The row is created from "Client" so an unknown id is skipped instead of failing on the foreign key.
    await tx.$executeRaw`
      INSERT INTO "ClientMetrics" ("clientId", "updatedAt")
      SELECT c."id", now() FROM "Client" c WHERE c."id" = ANY(${ids}::text[])
      ORDER BY c."id" COLLATE "C"
      ON CONFLICT ("clientId") DO NOTHING`;
    await tx.$queryRaw`
      SELECT "clientId" FROM "ClientMetrics" WHERE "clientId" = ANY(${ids}::text[])
      ORDER BY "clientId" COLLATE "C" FOR UPDATE`;
  }

  async lockProjectMetrics(projectIds: readonly string[]): Promise<void> {
    const tx = this.host.requireTransaction('ReadModelWriterPort.lockProjectMetrics');
    const ids = [...new Set(projectIds)];
    if (ids.length === 0) return;
    await tx.$executeRaw`
      INSERT INTO "ProjectMetrics" ("projectId", "updatedAt")
      SELECT p."id", now() FROM "Project" p WHERE p."id" = ANY(${ids}::text[])
      ORDER BY p."id" COLLATE "C"
      ON CONFLICT ("projectId") DO NOTHING`;
    await tx.$queryRaw`
      SELECT "projectId" FROM "ProjectMetrics" WHERE "projectId" = ANY(${ids}::text[])
      ORDER BY "projectId" COLLATE "C" FOR UPDATE`;
  }

  async writeClientMetrics(clientId: string, columns: ClientMoneyColumns): Promise<void> {
    const tx = this.host.requireTransaction('ReadModelWriterPort.writeClientMetrics');
    const money = {
      invoicedUsd: dec(columns.invoicedUsd),
      collectedUsd: dec(columns.collectedUsd),
      receivableUsd: dec(columns.receivableUsd),
      overdueUsd: dec(columns.overdueUsd),
      creditUsd: dec(columns.creditUsd),
    };
    await tx.clientMetrics.upsert({
      where: { clientId },
      create: { clientId, ...money },
      update: money,
    });
  }

  async writeProjectMetrics(projectId: string, columns: ProjectMoneyColumns): Promise<void> {
    const tx = this.host.requireTransaction('ReadModelWriterPort.writeProjectMetrics');
    const money = {
      contractedUsd: dec(columns.contractedUsd),
      invoicedUsd: dec(columns.invoicedUsd),
      collectedUsd: dec(columns.collectedUsd),
      toInvoiceUsd: dec(columns.toInvoiceUsd),
      receivableUsd: dec(columns.receivableUsd),
      expensesUsd: dec(columns.expensesUsd),
      marginUsd: dec(columns.marginUsd),
      monthlyRecurringUsd: dec(columns.monthlyRecurringUsd),
    };
    await tx.projectMetrics.upsert({
      where: { projectId },
      create: { projectId, ...money },
      update: money,
    });
  }

  async writeAccountBalance(accountId: string, balance: MoneyString, at: Date): Promise<void> {
    const tx = this.host.requireTransaction('ReadModelWriterPort.writeAccountBalance');
    await tx.account.update({
      where: { id: accountId },
      data: { balance: dec(balance), balanceAt: at },
    });
  }

  async writeInvoiceCache(invoiceId: string, cache: InvoiceCacheWrite): Promise<void> {
    const tx = this.host.requireTransaction('ReadModelWriterPort.writeInvoiceCache');
    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        subtotal: dec(cache.subtotal),
        discount: dec(cache.discount),
        exemptAmount: dec(cache.exemptAmount),
        taxBase: dec(cache.taxBase),
        ivaAmount: dec(cache.ivaAmount),
        total: dec(cache.total),
        receivable: dec(cache.receivable),
        totalUsd: dec(cache.totalUsd),
        receivableUsd: dec(cache.receivableUsd),
        paidAmount: dec(cache.paidAmount),
        balance: dec(cache.balance),
        status: cache.status,
      },
    });
    for (const line of cache.lines) {
      await tx.invoiceLine.update({
        where: { id: line.id },
        data: { amount: dec(line.amount), netAmount: dec(line.netAmount) },
      });
    }
    await tx.invoiceTaxLine.deleteMany({ where: { invoiceId } });
    if (cache.taxLines.length > 0) {
      await tx.invoiceTaxLine.createMany({
        data: cache.taxLines.map((line) => ({
          invoiceId,
          ivaRate: dec(line.ivaRate),
          taxBase: dec(line.taxBase),
          ivaAmount: dec(line.ivaAmount),
        })),
      });
    }
  }

  async writePaymentCache(
    paymentId: string,
    cache: { allocatable: MoneyString; netCredited: MoneyString; unallocated: MoneyString },
  ): Promise<void> {
    const tx = this.host.requireTransaction('ReadModelWriterPort.writePaymentCache');
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        allocatable: dec(cache.allocatable),
        netCredited: dec(cache.netCredited),
        unallocated: dec(cache.unallocated),
      },
    });
  }

  async writeInstallmentStatus(installmentId: string, status: InstallmentStatus): Promise<void> {
    const tx = this.host.requireTransaction('ReadModelWriterPort.writeInstallmentStatus');
    await tx.billingInstallment.update({ where: { id: installmentId }, data: { status } });
  }

  async writeRecurringChargeMonthlyUsd(id: string, monthlyAmountUsd: MoneyString): Promise<void> {
    const tx = this.host.requireTransaction('ReadModelWriterPort.writeRecurringChargeMonthlyUsd');
    await tx.recurringCharge.update({
      where: { id },
      data: { monthlyAmountUsd: dec(monthlyAmountUsd) },
    });
  }

  async writeRecurringExpenseMonthlyUsd(id: string, monthlyAmountUsd: MoneyString): Promise<void> {
    const tx = this.host.requireTransaction('ReadModelWriterPort.writeRecurringExpenseMonthlyUsd');
    await tx.recurringExpense.update({
      where: { id },
      data: { monthlyAmountUsd: dec(monthlyAmountUsd) },
    });
  }
}
