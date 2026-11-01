import { FinanceLookups } from '../../../src/modules/commercial/application/finance-lookups';
import { PrismaFinanceLookups } from '../../../src/modules/commercial/infrastructure/prisma-finance-lookups';
import type { PaymentReceiptFilesPort } from '../../../src/modules/finance/application/ports/payment-references.port';
import {
  AllocatePayment,
  DeallocatePayment,
} from '../../../src/modules/finance/application/use-cases/payments/allocate-payment.use-case';
import { CreatePayment } from '../../../src/modules/finance/application/use-cases/payments/create-payment.use-case';
import {
  DetectDuplicatePayment,
  GetClientCredit,
  GetInvoiceForPayment,
  GetPayment,
  ListPayments,
} from '../../../src/modules/finance/application/use-cases/payments/payment-reads.use-case';
import { PaymentSupport } from '../../../src/modules/finance/application/use-cases/payments/payment-support';
import { SetPaymentStatus } from '../../../src/modules/finance/application/use-cases/payments/set-payment-status.use-case';
import { UpdatePayment } from '../../../src/modules/finance/application/use-cases/payments/update-payment.use-case';
import { PaymentMethodCatalogQuery } from '../../../src/modules/settings/application/payment-method-catalog.query';
import { PrismaPaymentMethodRepository } from '../../../src/modules/settings/infrastructure/prisma-payment-method.repository';
import { PrismaPaymentReferences } from '../../../src/modules/finance/infrastructure/payment-references.adapter';
import { PrismaPaymentRepository } from '../../../src/modules/finance/infrastructure/prisma-payment.repository';
import type { PrismaReadModelWriter } from '../../../src/modules/finance/infrastructure/prisma-read-model-writer';
import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import type { ClockPort } from '../../../src/shared/application/ports/clock.port';
import type { RowLocksPort } from '../../../src/shared/application/ports/row-locks.port';
import type { UnitOfWorkPort } from '../../../src/shared/application/ports/unit-of-work.port';
import { CuidGenerator } from '../../../src/shared/infrastructure/id-generator.adapter';
import { PrismaActivityLog } from '../../../src/shared/infrastructure/prisma/prisma-activity-log';
import { PrismaRowLocks } from '../../../src/shared/infrastructure/prisma/prisma-row-locks';
import { PrismaSearchIndex } from '../../../src/shared/infrastructure/prisma/prisma-search-index';
import { PrismaSequence } from '../../../src/shared/infrastructure/prisma/prisma-sequence';
import type { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { buildInvoiceWorld } from '../invoices/int-world';

/** The business day of the integration tests: 2026-10-09 in Caracas. */
export const NOW = '2026-10-09T15:00:00.000Z';

export interface PaymentWorldHooks {
  /** Decorates the read-model writer, e.g. to pause a transaction once the source rows are written. */
  writer?: (writer: PrismaReadModelWriter) => PrismaReadModelWriter;
  clock?: ClockPort;
}

/**
 * `PAYMENT_CONCURRENCY_RED=1` removes the ordered locks and forces `ReadCommitted`: the concurrency tests must
 * then fail, which proves they detect the races the locks and `Serializable` close (observed RED, lesson B3).
 * Test-only toggle, like `INVOICE_CONCURRENCY_RED`.
 */
const RED = process.env.PAYMENT_CONCURRENCY_RED === '1';
const noLocks = (): RowLocksPort => ({ lock: async () => undefined });
const readCommitted = (uow: UnitOfWorkPort): UnitOfWorkPort => ({
  run: (work) => uow.run(work, { isolation: 'ReadCommitted' }),
});

/** Receipts are not claimed here: the platform context is exercised by the e2e spec. */
const receipts: PaymentReceiptFilesPort = {
  reserve: async (_actor, id) => ({ id, mimeType: 'application/pdf', sizeBytes: 2048 }),
};

/** The payment use cases over the real adapters, sharing one `TransactionHost` per world. */
export function buildPaymentWorld(service: PrismaService, hooks: PaymentWorldHooks = {}) {
  const base = buildInvoiceWorld(service, {
    ...(hooks.writer ? { writer: hooks.writer } : {}),
    ...(hooks.clock ? { clock: hooks.clock } : {}),
  });
  const { host, projector, metrics } = base;
  const uow = RED ? readCommitted(base.uow) : base.uow;
  const locks = RED ? noLocks() : new PrismaRowLocks(host);
  const clock = hooks.clock ?? new FixedClock(NOW);
  const authorization = new MatrixAuthorization();
  const ids = new CuidGenerator();
  const sequence = new PrismaSequence(host);
  const payments = new PrismaPaymentRepository(host);
  const references = new PrismaPaymentReferences(
    host,
    new FinanceLookups(new PrismaFinanceLookups(host)),
    new PaymentMethodCatalogQuery(new PrismaPaymentMethodRepository(host)),
  );
  const support = new PaymentSupport(
    payments,
    base.invoices,
    references,
    receipts,
    base.support,
    base.recompute,
    projector,
    new PrismaSearchIndex(host),
    new PrismaActivityLog(host, metrics),
    clock,
    locks,
  );
  return {
    ...base,
    uow,
    payments,
    references,
    paymentSupport: support,
    list: new ListPayments(authorization, payments),
    get: new GetPayment(authorization, payments),
    credit: new GetClientCredit(authorization, payments, references),
    duplicates: new DetectDuplicatePayment(authorization, payments),
    paymentContext: new GetInvoiceForPayment(authorization, base.invoices, references),
    createPayment: new CreatePayment(authorization, uow, support, sequence, ids),
    updatePayment: new UpdatePayment(authorization, uow, support),
    setStatus: new SetPaymentStatus(authorization, uow, support),
    allocate: new AllocatePayment(authorization, uow, support, ids),
    deallocate: new DeallocatePayment(authorization, uow, support),
  };
}

export type PaymentWorld = ReturnType<typeof buildPaymentWorld>;
