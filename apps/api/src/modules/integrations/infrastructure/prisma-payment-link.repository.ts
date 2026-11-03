import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { stringToDecimal } from '../../../shared/infrastructure/prisma/decimal-mapper';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { PaymentLinkRepository } from '../application/ports/payment-link.repository.port';
import type { PaymentLink } from '../domain/payment-link';

const OPEN_STATUSES = ['PENDING', 'ACTIVE'] as const;

type LinkRow = Prisma.InvoicePaymentLinkGetPayload<object>;

function toDomain(row: LinkRow): PaymentLink {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    requestId: row.requestId,
    provider: row.provider,
    externalId: row.externalId,
    url: row.url,
    // The column is `Decimal(18, 2)`: always two decimals, like every amount the domain holds.
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

/** `PaymentLinkRepository` over `InvoicePaymentLink`. Runs in the ambient transaction when there is one. */
@Injectable()
export class PrismaPaymentLinkRepository implements PaymentLinkRepository {
  constructor(private readonly host: TransactionHost) {}

  async save(link: PaymentLink): Promise<void> {
    const data = {
      invoiceId: link.invoiceId,
      requestId: link.requestId,
      provider: link.provider,
      externalId: link.externalId,
      url: link.url,
      amount: stringToDecimal(link.amount),
      currency: link.currency,
      status: link.status,
      paymentId: link.paymentId,
      deactivationReason: link.deactivationReason,
      createdAt: link.createdAt,
      createdById: link.createdById,
      deactivatedAt: link.deactivatedAt,
      settledAt: link.settledAt,
    };
    await this.host.db.invoicePaymentLink.upsert({
      where: { id: link.id },
      create: { id: link.id, ...data },
      update: data,
    });
  }

  async findById(id: string): Promise<PaymentLink | null> {
    const row = await this.host.db.invoicePaymentLink.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByRequestId(invoiceId: string, requestId: string): Promise<PaymentLink | null> {
    const row = await this.host.db.invoicePaymentLink.findUnique({
      where: { invoiceId_requestId: { invoiceId, requestId } },
    });
    return row ? toDomain(row) : null;
  }

  async findByExternalId(externalId: string): Promise<PaymentLink | null> {
    const row = await this.host.db.invoicePaymentLink.findUnique({ where: { externalId } });
    return row ? toDomain(row) : null;
  }

  async listByInvoice(invoiceId: string): Promise<PaymentLink[]> {
    const rows = await this.host.db.invoicePaymentLink.findMany({
      where: { invoiceId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toDomain);
  }

  async listInvoiceIdsWithOpenLinks(): Promise<string[]> {
    const rows = await this.host.db.invoicePaymentLink.findMany({
      where: { status: { in: [...OPEN_STATUSES] } },
      distinct: ['invoiceId'],
      select: { invoiceId: true },
      orderBy: { invoiceId: 'asc' },
    });
    return rows.map((row) => row.invoiceId);
  }

  async listPendingProviderDeactivation(): Promise<PaymentLink[]> {
    const rows = await this.host.db.invoicePaymentLink.findMany({
      where: { status: 'DEACTIVATED', externalId: { not: null }, providerDeactivatedAt: null },
      orderBy: [{ deactivatedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toDomain);
  }

  async markProviderDeactivated(linkId: string, at: Date): Promise<void> {
    await this.host.db.invoicePaymentLink.updateMany({
      where: { id: linkId },
      data: { providerDeactivatedAt: at },
    });
  }
}
