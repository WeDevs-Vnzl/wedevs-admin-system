// The deterministic interleaving helpers of BE-2 (`Gate`, `gated`, `interleave`) plus the documents world over
// real adapters; the versions and shares packages add their own builders here.
import { FinanceLookups } from '../../../src/modules/commercial/application/finance-lookups';
import { NoteLinkTargetRegistry } from '../../../src/modules/commercial/application/note-link-target.registry';
import { PrismaFinanceLookups } from '../../../src/modules/commercial/infrastructure/prisma-finance-lookups';
import { PrismaNoteTargetAdapter } from '../../../src/modules/commercial/infrastructure/prisma-note-target.adapter';
import {
  DocumentSupport,
  DocumentViews,
} from '../../../src/modules/documents/application/document-support';
import type { DocumentRepository } from '../../../src/modules/documents/application/ports/document.repository.port';
import { ArchiveDocument } from '../../../src/modules/documents/application/use-cases/records/archive-documents.use-case';
import { CreateDocument } from '../../../src/modules/documents/application/use-cases/records/create-document.use-case';
import { LinkDocument } from '../../../src/modules/documents/application/use-cases/records/link-document.use-case';
import { MarkExpiredDocuments } from '../../../src/modules/documents/application/use-cases/records/mark-expired-documents.use-case';
import { RestoreDocument } from '../../../src/modules/documents/application/use-cases/records/restore-document.use-case';
import { SetDocumentStatus } from '../../../src/modules/documents/application/use-cases/records/set-document-status.use-case';
import { PrismaDocumentRepository } from '../../../src/modules/documents/infrastructure/prisma-document.repository';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import { FileAccessRegistry } from '../../../src/modules/platform/application/file-access.registry';
import { ReserveFileForAttachment } from '../../../src/modules/platform/application/use-cases/reserve-file-for-attachment.use-case';
import { PrismaFileRepository } from '../../../src/modules/platform/infrastructure/prisma-file.repository';
import { DocumentTypeCatalog } from '../../../src/modules/settings/application/document-type-catalog';
import { TagAssignments } from '../../../src/modules/settings/application/tag-assignments';
import { PrismaDocumentCategoryRepository } from '../../../src/modules/settings/infrastructure/prisma-document-category.repository';
import { PrismaDocumentTypeRepository } from '../../../src/modules/settings/infrastructure/prisma-document-type.repository';
import { PrismaTagAssignmentRepository } from '../../../src/modules/settings/infrastructure/prisma-tag-assignment.repository';
import { PrismaTagRepository } from '../../../src/modules/settings/infrastructure/prisma-tag.repository';
import type { RowLocksPort } from '../../../src/shared/application/ports/row-locks.port';
import type { UnitOfWorkPort } from '../../../src/shared/application/ports/unit-of-work.port';
import { CuidGenerator } from '../../../src/shared/infrastructure/id-generator.adapter';
import { PrismaActivityLog } from '../../../src/shared/infrastructure/prisma/prisma-activity-log';
import { PrismaClientMetricsWriter } from '../../../src/shared/infrastructure/prisma/prisma-client-metrics-writer';
import { PrismaRowLocks } from '../../../src/shared/infrastructure/prisma/prisma-row-locks';
import { PrismaSearchIndex } from '../../../src/shared/infrastructure/prisma/prisma-search-index';
import { PrismaSequence } from '../../../src/shared/infrastructure/prisma/prisma-sequence';
import { PrismaUnitOfWork } from '../../../src/shared/infrastructure/prisma/prisma-unit-of-work';
import type { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../src/shared/infrastructure/prisma/transaction-host';
import { SystemClock } from '../../../src/shared/infrastructure/system-clock.adapter';

export { Gate, gated, interleave } from '../../commercial/concurrency/world';

export interface DocumentWorldHooks {
  /** Decorates the document repository, e.g. to pause a transaction at a `Gate` before a write. */
  documents?: (repository: DocumentRepository) => DocumentRepository;
  /** Decorates the row locks, e.g. with a no-op (the unlocked behavior). */
  locks?: (locks: RowLocksPort) => RowLocksPort;
  /** Decorates the unit of work, e.g. to force `ReadCommitted` (the unlocked behavior). */
  uow?: (uow: UnitOfWorkPort) => UnitOfWorkPort;
}

/** The unlocked behavior: row locks that lock nothing. */
export const noLocks = (): RowLocksPort => ({ lock: async () => undefined });

/** The unlocked behavior: every unit of work runs at `ReadCommitted`, whatever the use case asks. */
export const readCommitted = (uow: UnitOfWorkPort): UnitOfWorkPort => ({
  run: (work) => uow.run(work, { isolation: 'ReadCommitted' }),
});

/** The documents use cases over real adapters, sharing one `TransactionHost` per world. */
export function buildDocumentWorld(service: PrismaService, hooks: DocumentWorldHooks = {}) {
  const host = new TransactionHost(service);
  const uow = (hooks.uow ?? ((u) => u))(new PrismaUnitOfWork(host));
  const authorization = new MatrixAuthorization();
  const clock = new SystemClock();
  const ids = new CuidGenerator();
  const documents = (hooks.documents ?? ((d) => d))(new PrismaDocumentRepository(host));
  const locks = (hooks.locks ?? ((l) => l))(new PrismaRowLocks(host));
  const search = new PrismaSearchIndex(host);
  const activity = new PrismaActivityLog(host, new PrismaClientMetricsWriter(host));
  const tags = new TagAssignments(
    new PrismaTagRepository(host),
    new PrismaTagAssignmentRepository(host),
  );
  const catalog = new DocumentTypeCatalog(
    new PrismaDocumentCategoryRepository(host),
    new PrismaDocumentTypeRepository(host),
    { countDocuments: async () => 0 },
  );
  const targets = new NoteLinkTargetRegistry(new PrismaNoteTargetAdapter(host));
  const reserve = new ReserveFileForAttachment(
    authorization,
    new PrismaFileRepository(host),
    new FileAccessRegistry(),
  );
  const support = new DocumentSupport(
    documents,
    catalog,
    targets,
    new FinanceLookups(new PrismaFinanceLookups(host)),
    authorization,
    reserve,
    activity,
    search,
    locks,
    clock,
    ids,
  );
  const views = new DocumentViews(documents, tags, catalog, targets, authorization, clock);
  const restore = new RestoreDocument(authorization, uow, support);
  return {
    host,
    uow,
    documents,
    support,
    createDocument: new CreateDocument(
      authorization,
      uow,
      support,
      tags,
      new PrismaSequence(host),
      views,
    ),
    setStatus: new SetDocumentStatus(authorization, uow, support, views),
    archiveDocument: new ArchiveDocument(authorization, uow, support, search),
    restoreDocument: restore,
    linkDocument: new LinkDocument(authorization, uow, support, views),
    markExpired: new MarkExpiredDocuments(uow, support),
  };
}
export type DocumentWorld = ReturnType<typeof buildDocumentWorld>;
