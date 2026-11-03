import type {
  IntegrationEventEntry,
  IntegrationEventStore,
  RecordEventResult,
} from '../../src/modules/integrations/application/ports/integration-event-store.port';
import {
  AllocatePayment,
  DeallocatePayment,
} from '../../src/modules/finance/application/use-cases/payments/allocate-payment.use-case';
import { RecordProviderPayment } from '../../src/modules/finance/application/use-cases/payments/record-provider-payment.use-case';
import { SetPaymentStatus } from '../../src/modules/finance/application/use-cases/payments/set-payment-status.use-case';
import { PrismaProviderPaymentReference } from '../../src/modules/finance/infrastructure/prisma-payment-link-settlement.adapter';
import { PrismaPaymentLinkSettlement } from '../../src/modules/integrations/infrastructure/prisma-payment-link-settlement.adapter';
import { MatrixAuthorization } from '../../src/modules/identity/application/matrix-authorization';
import { CuidGenerator } from '../../src/shared/infrastructure/id-generator.adapter';
import { PrismaSequence } from '../../src/shared/infrastructure/prisma/prisma-sequence';
import type { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service';
import type { TransactionHost } from '../../src/shared/infrastructure/prisma/transaction-host';
import { buildPaymentWorld, type PaymentWorldHooks } from './payments/int-world';
import { FakeRates } from './provider-payment-world';

/**
 * Test-only `IntegrationEventStore` over the real table: `ON CONFLICT DO NOTHING` so a repeated delivery is a
 * `DUPLICATE` and not an aborted transaction. The real adapter belongs to `integrations`.
 */
export class PrismaTestEventStore implements IntegrationEventStore {
  constructor(
    private readonly host: TransactionHost,
    /** Test toggle for the observed RED: never reports a duplicate. */
    private readonly blind = false,
  ) {}

  async record(entry: IntegrationEventEntry): Promise<RecordEventResult> {
    const { count } = await this.host.db.integrationEvent.createMany({
      data: [{ ...entry }],
      skipDuplicates: true,
    });
    return count === 1 || this.blind ? 'RECORDED' : 'DUPLICATE';
  }

  async find(provider: IntegrationEventEntry['provider'], eventId: string) {
    const row = await this.host.db.integrationEvent.findUnique({
      where: { provider_eventId: { provider, eventId } },
    });
    return row
      ? {
          provider: row.provider,
          eventId: row.eventId,
          type: row.type,
          outcome: row.outcome,
          reasonCode: row.reasonCode,
          entityType: row.entityType,
          entityId: row.entityId,
          receivedAt: row.receivedAt,
          processedAt: row.processedAt,
        }
      : null;
  }
}

/** `PROVIDER_PAYMENT_CONCURRENCY_RED=1` makes the event store blind to duplicates (observed RED). */
const RED = process.env.PROVIDER_PAYMENT_CONCURRENCY_RED === '1';

/** The provider-payment use case and the two hooked payment use cases over the real adapters. */
export function buildProviderPaymentWorld(service: PrismaService, hooks: PaymentWorldHooks = {}) {
  const base = buildPaymentWorld(service, hooks);
  const { host, uow, paymentSupport } = base;
  const settlement = new PrismaPaymentLinkSettlement(host);
  const reference = new PrismaProviderPaymentReference(host);
  const rates = new FakeRates();
  const authorization = new MatrixAuthorization();
  const ids = new CuidGenerator();
  return {
    ...base,
    rates,
    events: new PrismaTestEventStore(host, RED),
    record: new RecordProviderPayment(
      uow,
      paymentSupport,
      new PrismaSequence(host),
      ids,
      new PrismaTestEventStore(host, RED),
      rates,
      settlement,
      reference,
    ),
    allocateWithSettlement: new AllocatePayment(
      authorization,
      uow,
      paymentSupport,
      ids,
      settlement,
    ),
    deallocateWithSettlement: new DeallocatePayment(authorization, uow, paymentSupport, settlement),
    setStatusWithSettlement: new SetPaymentStatus(authorization, uow, paymentSupport, settlement),
  };
}

export type ProviderPaymentIntWorld = ReturnType<typeof buildProviderPaymentWorld>;
