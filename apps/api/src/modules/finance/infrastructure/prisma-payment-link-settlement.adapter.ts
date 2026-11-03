import { Inject, Injectable } from '@nestjs/common';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { ProviderPaymentReferencePort } from '../application/ports/payment-link-settlement.port';

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
