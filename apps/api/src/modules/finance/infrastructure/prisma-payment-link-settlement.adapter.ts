import { Inject, Injectable } from '@nestjs/common';
import { compareMoney, type MoneyString } from '../../../shared/domain/money';
import { decimalToString } from '../../../shared/infrastructure/prisma/decimal-mapper';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type {
  PaymentLinkSettlementPort,
  ProviderPaymentReferencePort,
} from '../application/ports/payment-link-settlement.port';

/**
 * Writes `InvoicePaymentLink` inside the caller's unit of work (A13, DT-199). Each write is a guarded
 * `updateMany` on the expected status, so a link that moved meanwhile is a no-op (`false`), never an error.
 * The link lifecycle rules live in `integrations`; this adapter only performs the three steps finance owns.
 */
@Injectable()
export class PrismaPaymentLinkSettlement implements PaymentLinkSettlementPort {
  constructor(@Inject(TransactionHost) private readonly host: TransactionHost) {}

  async complete(input: {
    linkId: string;
    invoiceId: string;
    paymentId: string;
  }): Promise<boolean> {
    const { count } = await this.host.db.invoicePaymentLink.updateMany({
      where: { id: input.linkId, invoiceId: input.invoiceId, status: 'ACTIVE', paymentId: null },
      data: { status: 'COMPLETED', paymentId: input.paymentId },
    });
    return count > 0;
  }

  async settleOnAllocation(input: {
    paymentId: string;
    invoiceId: string;
    allocatedInvoiceCurrency: MoneyString;
    at: string;
  }): Promise<boolean> {
    const link = await this.host.db.invoicePaymentLink.findFirst({
      where: { paymentId: input.paymentId, invoiceId: input.invoiceId, status: 'COMPLETED' },
    });
    if (!link) return false;
    if (compareMoney(input.allocatedInvoiceCurrency, decimalToString(link.amount)) < 0)
      return false;
    return this.settle(link.id, input.at);
  }

  async settleOnVoid(input: { paymentId: string; at: string }): Promise<boolean> {
    const link = await this.host.db.invoicePaymentLink.findFirst({
      where: { paymentId: input.paymentId, status: 'COMPLETED' },
    });
    return link ? this.settle(link.id, input.at) : false;
  }

  private async settle(id: string, at: string): Promise<boolean> {
    const { count } = await this.host.db.invoicePaymentLink.updateMany({
      where: { id, status: 'COMPLETED' },
      data: { status: 'SETTLED', settledAt: new Date(at) },
    });
    return count > 0;
  }
}

/** `Payment.externalProvider` / `externalId` (Δ18) read and stamped inside the caller's unit of work. */
@Injectable()
export class PrismaProviderPaymentReference implements ProviderPaymentReferencePort {
  constructor(@Inject(TransactionHost) private readonly host: TransactionHost) {}

  async findPaymentId(provider: string, externalId: string): Promise<string | null> {
    const row = await this.host.db.payment.findFirst({
      where: { externalProvider: provider as 'STRIPE' | 'BINANCE' | 'BANK', externalId },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  async stamp(paymentId: string, provider: string, externalId: string): Promise<void> {
    await this.host.db.payment.update({
      where: { id: paymentId },
      data: { externalProvider: provider as 'STRIPE' | 'BINANCE' | 'BANK', externalId },
    });
  }
}
