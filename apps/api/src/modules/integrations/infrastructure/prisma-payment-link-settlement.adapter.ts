import { Inject, Injectable } from '@nestjs/common';
import { ConflictError } from '../../../shared/domain';
import { compareMoney, type MoneyString } from '../../../shared/domain/money';
import type { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { PaymentLinkSettlementPort } from '../../finance/application/ports/payment-link-settlement.port';
import { completeLink, settleLink, unsettleLink, type PaymentLink } from '../domain/payment-link';

type LinkRow = Prisma.InvoicePaymentLinkGetPayload<object>;

function toDomain(row: LinkRow): PaymentLink {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    requestId: row.requestId,
    provider: row.provider,
    externalId: row.externalId,
    url: row.url,
    amount: row.amount.toFixed(2),
    currency: row.currency,
    status: row.status,
    paymentId: row.paymentId,
    deactivationReason: row.deactivationReason,
    createdAt: row.createdAt,
    createdById: row.createdById,
    deactivatedAt: row.deactivatedAt,
    settledAt: row.settledAt,
  };
}

/**
 * Finance's `PaymentLinkSettlementPort` over `InvoicePaymentLink` (A13, DT-199, DT-110): finance declares the
 * port, `integrations` owns the table and the lifecycle, so the transitions are decided by `domain/payment-link`
 * and this adapter only persists them. It reads and writes through the ambient `TransactionHost`, i.e. inside
 * the unit of work of the finance use case that calls it. Each write is guarded on the status that was read, so
 * a link that moved meanwhile (or an illegal step) is a no-op (`false`), never an error.
 */
@Injectable()
export class PrismaPaymentLinkSettlement implements PaymentLinkSettlementPort {
  constructor(@Inject(TransactionHost) private readonly host: TransactionHost) {}

  async complete(input: {
    linkId: string;
    invoiceId: string;
    paymentId: string;
  }): Promise<boolean> {
    const row = await this.host.db.invoicePaymentLink.findFirst({
      where: { id: input.linkId, invoiceId: input.invoiceId, status: 'ACTIVE', paymentId: null },
    });
    return row ? this.apply(row, (link) => completeLink(link, input.paymentId)) : false;
  }

  async settleOnAllocation(input: {
    paymentId: string;
    invoiceId: string;
    allocatedInvoiceCurrency: MoneyString;
    at: string;
  }): Promise<boolean> {
    const row = await this.host.db.invoicePaymentLink.findFirst({
      where: { paymentId: input.paymentId, invoiceId: input.invoiceId, status: 'COMPLETED' },
    });
    if (!row) return false;
    if (compareMoney(input.allocatedInvoiceCurrency, row.amount.toFixed(2)) < 0) return false;
    return this.apply(row, (link) => settleLink(link, new Date(input.at)));
  }

  async settleOnVoid(input: { paymentId: string; at: string }): Promise<boolean> {
    const row = await this.host.db.invoicePaymentLink.findFirst({
      where: { paymentId: input.paymentId, status: 'COMPLETED' },
    });
    return row ? this.apply(row, (link) => settleLink(link, new Date(input.at))) : false;
  }

  async unsettleOnDeallocation(input: { paymentId: string; invoiceId: string }): Promise<boolean> {
    const row = await this.host.db.invoicePaymentLink.findFirst({
      where: { paymentId: input.paymentId, invoiceId: input.invoiceId, status: 'SETTLED' },
    });
    return row ? this.apply(row, unsettleLink) : false;
  }

  private async apply(row: LinkRow, step: (link: PaymentLink) => PaymentLink): Promise<boolean> {
    let next: PaymentLink;
    try {
      next = step(toDomain(row));
    } catch (error) {
      if (error instanceof ConflictError) return false;
      throw error;
    }
    const { count } = await this.host.db.invoicePaymentLink.updateMany({
      where: { id: row.id, status: row.status },
      data: { status: next.status, paymentId: next.paymentId, settledAt: next.settledAt },
    });
    return count > 0;
  }
}
