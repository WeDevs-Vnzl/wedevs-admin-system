import { FinanceLookups } from '../../../src/modules/commercial/application/finance-lookups';
import { PrismaFinanceLookups } from '../../../src/modules/commercial/infrastructure/prisma-finance-lookups';
import type {
  InvoiceFilesPort,
  InvoiceFiscalPort,
} from '../../../src/modules/finance/application/ports/invoice-references.port';
import type { InvoiceRepository } from '../../../src/modules/finance/application/ports/invoice.repository.port';
import { ArchiveInvoice } from '../../../src/modules/finance/application/use-cases/invoices/archive-invoice.use-case';
import { CreateInvoice } from '../../../src/modules/finance/application/use-cases/invoices/create-invoice.use-case';
import { InvoiceSupport } from '../../../src/modules/finance/application/use-cases/invoices/invoice-support';
import { MarkOverdueInvoices } from '../../../src/modules/finance/application/use-cases/invoices/mark-overdue-invoices.use-case';
import { RecomputeInstallmentStatus } from '../../../src/modules/finance/application/use-cases/billing/recompute-installment-status';
import { RecomputeInvoice } from '../../../src/modules/finance/application/use-cases/invoices/recompute-invoice.use-case';
import { RestoreInvoice } from '../../../src/modules/finance/application/use-cases/invoices/restore-invoice.use-case';
import { UpdateInvoice } from '../../../src/modules/finance/application/use-cases/invoices/update-invoice.use-case';
import { VoidInvoice } from '../../../src/modules/finance/application/use-cases/invoices/void-invoice.use-case';
import { CommercialInvoiceReferences } from '../../../src/modules/finance/infrastructure/invoice-references.adapter';
import { PrismaBillingRepository } from '../../../src/modules/finance/infrastructure/prisma-billing.repository';
import { PrismaInvoiceRepository } from '../../../src/modules/finance/infrastructure/prisma-invoice.repository';
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
import { buildWorld as buildReadModels } from '../read-models/world';

/** The business day of the integration tests: 2026-10-09 in Caracas. */
export const NOW = '2026-10-09T15:00:00.000Z';

export interface InvoiceWorldHooks {
  /** Decorates the row locks, e.g. to observe the unlocked behavior. */
  locks?: (locks: RowLocksPort) => RowLocksPort;
  /** Decorates the unit of work, e.g. to force a weaker isolation. */
  uow?: (uow: UnitOfWorkPort) => UnitOfWorkPort;
  /** Decorates the read-model writer, e.g. to pause a transaction once the source row is written. */
  writer?: (writer: PrismaReadModelWriter) => PrismaReadModelWriter;
  /** Decorates the invoice repository. */
  repository?: (repository: InvoiceRepository) => InvoiceRepository;
  clock?: ClockPort;
}

/**
 * `INVOICE_CONCURRENCY_RED=1` removes the ordered locks and forces `ReadCommitted`: the concurrency tests must
 * then fail, which proves they detect the races the locks and `Serializable` close (observed RED, lesson B3).
 */
const RED = process.env.INVOICE_CONCURRENCY_RED === '1';
const noLocks = (): RowLocksPort => ({ lock: async () => undefined });
const readCommitted = (uow: UnitOfWorkPort): UnitOfWorkPort => ({
  run: (work) => uow.run(work, { isolation: 'ReadCommitted' }),
});

const fiscal: InvoiceFiscalPort = { allowedIvaRates: async () => ['16', '8', '0'] };
const files: InvoiceFilesPort = {
  reserve: async (_actor, id) => ({ id, mimeType: 'application/pdf', sizeBytes: 2048 }),
};

/** The invoice use cases over the real adapters, sharing one `TransactionHost` per world. */
export function buildInvoiceWorld(service: PrismaService, hooks: InvoiceWorldHooks = {}) {
  const base = buildReadModels(service, hooks.writer ? { writer: hooks.writer } : {});
  const { host, projector, metrics } = base;
  const uow = (hooks.uow ?? ((u) => u))(RED ? readCommitted(base.uow) : base.uow);
  const authorization = new MatrixAuthorization();
  const clock = hooks.clock ?? new FixedClock(NOW);
  const ids = new CuidGenerator();
  const locks = (hooks.locks ?? ((l) => l))(RED ? noLocks() : new PrismaRowLocks(host));
  const search = new PrismaSearchIndex(host);
  const sequence = new PrismaSequence(host);
  const activity = new PrismaActivityLog(host, metrics);
  const invoices = (hooks.repository ?? ((r) => r))(new PrismaInvoiceRepository(host));
  const references = new CommercialInvoiceReferences(
    new FinanceLookups(new PrismaFinanceLookups(host)),
  );
  const currencies = {
    knownCodes: async (codes: readonly string[]) =>
      new Set(
        (
          await host.db.currency.findMany({
            where: { code: { in: [...codes] } },
            select: { code: true },
          })
        ).map((row) => row.code),
      ),
  };
  const support = new InvoiceSupport(
    invoices,
    references,
    fiscal,
    files,
    currencies,
    projector,
    new RecomputeInstallmentStatus(uow, new PrismaBillingRepository(host)),
    search,
    activity,
    clock,
    locks,
  );
  return {
    ...base,
    uow,
    invoices,
    support,
    create: new CreateInvoice(authorization, uow, support, sequence, ids),
    update: new UpdateInvoice(authorization, uow, support, ids),
    voidInvoice: new VoidInvoice(authorization, uow, support),
    archive: new ArchiveInvoice(authorization, uow, support),
    restore: new RestoreInvoice(authorization, uow, support),
    recompute: new RecomputeInvoice(support),
    markOverdue: new MarkOverdueInvoices(uow, invoices, support, clock),
  };
}

export type InvoiceWorld = ReturnType<typeof buildInvoiceWorld>;
