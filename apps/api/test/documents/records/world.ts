import { FinanceLookups } from '../../../src/modules/commercial/application/finance-lookups';
import {
  NoteLinkTargetRegistry,
  type NoteLinkTargetResolver,
} from '../../../src/modules/commercial/application/note-link-target.registry';
import type { ResolvedNoteTarget } from '../../../src/modules/commercial/application/ports/note-target.port';
import {
  DocumentSupport,
  DocumentViews,
} from '../../../src/modules/documents/application/document-support';
import type {
  DocumentRecord,
  UserRef,
} from '../../../src/modules/documents/application/ports/document.repository.port';
import {
  ArchiveDocument,
  ArchiveDocuments,
} from '../../../src/modules/documents/application/use-cases/records/archive-documents.use-case';
import { CreateDocument } from '../../../src/modules/documents/application/use-cases/records/create-document.use-case';
import {
  LinkDocument,
  UnlinkDocument,
} from '../../../src/modules/documents/application/use-cases/records/link-document.use-case';
import {
  CountDocumentsByCategory,
  GetDocument,
  ListDocuments,
} from '../../../src/modules/documents/application/use-cases/records/list-documents.use-case';
import { MarkExpiredDocuments } from '../../../src/modules/documents/application/use-cases/records/mark-expired-documents.use-case';
import { RestoreDocument } from '../../../src/modules/documents/application/use-cases/records/restore-document.use-case';
import { SetDocumentStatus } from '../../../src/modules/documents/application/use-cases/records/set-document-status.use-case';
import { UpdateDocumentMeta } from '../../../src/modules/documents/application/use-cases/records/update-document-meta.use-case';
import {
  DocumentNoteTargetResolver,
  DocumentRestoreHandler,
  DocumentTaggableResolver,
} from '../../../src/modules/documents/infrastructure/document-registry.resolvers';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import { FileAccessRegistry } from '../../../src/modules/platform/application/file-access.registry';
import { ReserveFileForAttachment } from '../../../src/modules/platform/application/use-cases/reserve-file-for-attachment.use-case';
import type { StoredFile } from '../../../src/modules/platform/domain/file';
import { DocumentTypeCatalog } from '../../../src/modules/settings/application/document-type-catalog';
import { TagAssignments } from '../../../src/modules/settings/application/tag-assignments';
import type { DocumentType } from '../../../src/modules/settings/domain/document-type';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import type { DateOnly } from '../../../src/shared/domain/business-date';
import type { UserRole } from '../../../src/shared/domain/enums';
import { DEFAULT_LIST_QUERY, type ListQuery } from '../../../src/shared/domain/list-query';
import { InMemoryFileRepository } from '../../files/in-memory-file.repository';
import { FakeNoteTargets } from '../../commercial/notes/fakes/fake-note-targets';
import { InMemoryFinanceLookupsSource } from '../../commercial/finance-lookups/fakes/in-memory-finance-lookups.source';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { InMemoryActivityLog } from '../../support/fakes/in-memory-activity-log';
import { InMemoryRowLocks } from '../../support/fakes/in-memory-row-locks';
import { InMemorySearchIndex } from '../../support/fakes/in-memory-search-index';
import { InMemorySequence } from '../../support/fakes/in-memory-sequence';
import { InMemoryUnitOfWork } from '../../support/fakes/in-memory-unit-of-work';
import { SequentialIdGenerator } from '../../support/fakes/sequential-id-generator';
import { InMemoryDocumentCategoryRepository } from '../../settings/document-types/fakes/in-memory-document-category.repository';
import { InMemoryDocumentTypeRepository } from '../../settings/document-types/fakes/in-memory-document-type.repository';
import { FakeDocumentTypeUsage } from '../../settings/document-types/fakes/fake-document-type-usage';
import { CATEGORY_ROWS, TYPE_ROWS } from '../../settings/document-types/fixtures';
import { InMemoryTagAssignmentRepository, InMemoryTagRepository } from '../../settings/tags/fakes';
import { InMemoryDocumentRepository } from './fakes/in-memory-document.repository';

export const userOf = (role: UserRole, name = role.toLowerCase()): CurrentUser => ({
  userId: `usr_${name}`,
  clerkId: `clerk_${name}`,
  role,
  email: `${name}@example.test`,
  name,
});
export const owner = userOf('OWNER');
export const admin = userOf('ADMIN');
export const member = userOf('MEMBER');
export const viewer = userOf('VIEWER');

/** Types the settings fixture lacks: an NDA (signature and expiry), a markdown note, a link and a free file. */
const EXTRA_TYPES: readonly DocumentType[] = [
  {
    id: 'dtyp_nda',
    categoryId: 'dcat_legal',
    name: 'NDA',
    nameEn: 'NDA',
    requiresSignature: true,
    hasExpiration: true,
    defaultFormat: 'ARCHIVO',
    active: true,
  },
  {
    id: 'dtyp_nota',
    categoryId: 'dcat_tecnico',
    name: 'Nota técnica',
    nameEn: null,
    requiresSignature: false,
    hasExpiration: false,
    defaultFormat: 'MARKDOWN',
    active: true,
  },
  {
    id: 'dtyp_enlace',
    categoryId: 'dcat_operativo',
    name: 'Enlace externo',
    nameEn: null,
    requiresSignature: false,
    hasExpiration: false,
    defaultFormat: 'ENLACE',
    active: true,
  },
  {
    id: 'dtyp_manual',
    categoryId: 'dcat_operativo',
    name: 'Manual',
    nameEn: null,
    requiresSignature: false,
    hasExpiration: true,
    defaultFormat: 'ARCHIVO',
    active: true,
  },
];

/** A finance-side note target (invoice, payment or expense) the test adds. */
export class FakeFinanceTargets implements NoteLinkTargetResolver {
  private readonly rows = new Map<string, ResolvedNoteTarget>();

  constructor(readonly entityType: 'INVOICE' | 'PAYMENT' | 'EXPENSE') {}

  add(id: string, label: string, code = id): void {
    this.rows.set(id, { ref: { type: this.entityType, id, code, label }, archived: false });
  }

  async resolve(ids: readonly string[]): Promise<Map<string, ResolvedNoteTarget>> {
    const found = new Map<string, ResolvedNoteTarget>();
    for (const id of ids) {
      const row = this.rows.get(id);
      if (row) found.set(id, row);
    }
    return found;
  }
}

export const query = (over: Partial<ListQuery> = {}): ListQuery => ({
  ...DEFAULT_LIST_QUERY,
  sort: { field: 'updatedAt', direction: 'desc' },
  ...over,
});

/** Every in-memory port of the document records slice wired with the real use cases and the real matrix. */
export function createWorld() {
  const clock = new FixedClock('2026-10-30T12:00:00.000Z');
  const uow = new InMemoryUnitOfWork();
  const activity = new InMemoryActivityLog(uow);
  const search = new InMemorySearchIndex(uow);
  const sequence = new InMemorySequence(uow);
  const locks = new InMemoryRowLocks(uow);
  const authorization = new MatrixAuthorization();
  const users = new Map<string, CurrentUser>();
  const fileRepo = new InMemoryFileRepository();
  const fileRegistry = new FileAccessRegistry();
  const reserve = new ReserveFileForAttachment(authorization, fileRepo, fileRegistry);

  const categories = new InMemoryDocumentCategoryRepository(uow);
  const types = new InMemoryDocumentTypeRepository(uow);
  categories.seed(CATEGORY_ROWS);
  types.seed([...TYPE_ROWS, ...EXTRA_TYPES]);
  const catalog = new DocumentTypeCatalog(categories, types, new FakeDocumentTypeUsage());

  const assignmentRepo = new InMemoryTagAssignmentRepository(uow);
  const tagRepo = new InMemoryTagRepository(uow, assignmentRepo);
  const tags = new TagAssignments(tagRepo, assignmentRepo);

  const noteTargets = new FakeNoteTargets();
  const targets = new NoteLinkTargetRegistry(noteTargets);
  const invoices = new FakeFinanceTargets('INVOICE');
  const payments = new FakeFinanceTargets('PAYMENT');
  const expenses = new FakeFinanceTargets('EXPENSE');
  for (const resolver of [invoices, payments, expenses]) targets.register(resolver);
  const lookupSource = new InMemoryFinanceLookupsSource();
  const lookups = new FinanceLookups(lookupSource);

  /** Share links the fake repository sees, by document id. */
  const shares = new Map<string, { revokedAt: Date | null; expiresAt: DateOnly | null }[]>();
  const typeRows = new Map([...TYPE_ROWS, ...EXTRA_TYPES].map((type) => [type.id, type]));
  const documents = new InMemoryDocumentRepository(uow, {
    categoryOfType: (typeId) => typeRows.get(typeId)?.categoryId ?? null,
    userRef: (id): UserRef => {
      const user = users.get(id);
      return { id, name: user?.name ?? id, imageUrl: null };
    },
    file: (id) => {
      const file = fileRepo.rows.get(id);
      if (!file) throw new Error(`file ${id} not seeded`);
      return {
        id: file.id,
        originalName: file.originalName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        status: file.status,
        uploadedById: file.uploadedById,
        createdAt: file.createdAt,
      };
    },
    tagIdsOf: (documentId) =>
      assignmentRepo.committedIds({ entityType: 'DOCUMENT', entityId: documentId }),
    sharesOf: (documentId) => shares.get(documentId) ?? [],
  });

  const ids = new SequentialIdGenerator('doc');
  const support = new DocumentSupport(
    documents,
    catalog,
    targets,
    lookups,
    authorization,
    reserve,
    activity,
    search,
    locks,
    clock,
    ids,
  );
  const views = new DocumentViews(documents, tags, catalog, targets, authorization, clock);
  const restoreDocument = new RestoreDocument(authorization, uow, support);

  return {
    clock,
    uow,
    activity,
    search,
    sequence,
    locks,
    authorization,
    fileRepo,
    fileRegistry,
    catalog,
    types,
    assignmentRepo,
    tagRepo,
    tags,
    noteTargets,
    targets,
    invoices,
    payments,
    expenses,
    lookupSource,
    shares,
    documents,
    support,
    views,
    restoreDocument,
    restoreHandler: new DocumentRestoreHandler(restoreDocument),
    taggableResolver: new DocumentTaggableResolver(documents, support),
    noteTargetResolver: new DocumentNoteTargetResolver(documents),
    createDocument: new CreateDocument(authorization, uow, support, tags, sequence, views),
    updateMeta: new UpdateDocumentMeta(authorization, uow, support, tags, views),
    setStatus: new SetDocumentStatus(authorization, uow, support, views),
    archiveDocument: new ArchiveDocument(authorization, uow, support, search),
    archiveDocuments: new ArchiveDocuments(authorization, uow, support, search),
    linkDocument: new LinkDocument(authorization, uow, support, views),
    unlinkDocument: new UnlinkDocument(authorization, uow, support, views),
    listDocuments: new ListDocuments(authorization, documents, views, clock),
    countByCategory: new CountDocumentsByCategory(authorization, documents, clock),
    getDocument: new GetDocument(authorization, support, views),
    markExpired: new MarkExpiredDocuments(uow, support),
    addUser(user: CurrentUser): CurrentUser {
      users.set(user.userId, user);
      return user;
    },
    /** A `READY` file uploaded by `by`. */
    seedFile(id: string, by: CurrentUser, status: StoredFile['status'] = 'READY'): string {
      fileRepo.rows.set(id, {
        id,
        storageKey: `general/2026/10/${id}`,
        bucket: 'memory',
        originalName: `${id}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 100,
        status,
        uploadedById: by.userId,
        createdAt: clock.now(),
        deletedAt: null,
      });
      return id;
    },
    seedTag(id: string, name: string, color = '#112233') {
      tagRepo.seed({ id, name, color, createdAt: new Date('2026-01-01T00:00:00.000Z') });
    },
    /** A committed document the use cases cannot produce (e.g. one that already expired). */
    seedDocument(
      over: Partial<DocumentRecord> & Pick<DocumentRecord, 'id' | 'typeId'>,
    ): DocumentRecord {
      const row: DocumentRecord = {
        code: `DOC-${over.id}`,
        title: `Documento ${over.id}`,
        summary: null,
        status: 'BORRADOR',
        draftContent: null,
        draftUpdatedAt: null,
        currentVersionId: null,
        effectiveDate: null,
        signedAt: null,
        expiresAt: null,
        alertDaysBefore: 30,
        createdAt: clock.now(),
        updatedAt: clock.now(),
        createdById: null,
        deletedAt: null,
        ...over,
      };
      documents.seed(row);
      return row;
    },
  };
}
export type World = ReturnType<typeof createWorld>;

export const KAIROS = { entityType: 'CLIENT', entityId: 'cli_kairos' } as const;
export const SOLARIS = { entityType: 'CLIENT', entityId: 'cli_solaris' } as const;
export const KAIROS_WEB = { entityType: 'PROJECT', entityId: 'pry_kairos_web' } as const;
export const KAIROS_ALT = { entityType: 'PROJECT', entityId: 'pry_kairos_app' } as const;
export const ANA = { entityType: 'CONTACT', entityId: 'con_ana' } as const;
export const INVOICE_1 = { entityType: 'INVOICE', entityId: 'inv_1' } as const;
export const PAYMENT_1 = { entityType: 'PAYMENT', entityId: 'pay_1' } as const;
export const EXPENSE_1 = { entityType: 'EXPENSE', entityId: 'exp_1' } as const;

/** A world with the four roles, two clients, a contact, two projects of one client and one record per finance type. */
export function seededWorld() {
  const world = createWorld();
  for (const user of [owner, admin, member, viewer]) world.addUser(user);
  world.noteTargets.add('CLIENT', 'cli_kairos', 'Kairos');
  world.noteTargets.add('CLIENT', 'cli_solaris', 'Solaris');
  world.noteTargets.add('CONTACT', 'con_ana', 'Ana');
  world.noteTargets.add('PROJECT', 'pry_kairos_web', 'Kairos Web');
  world.noteTargets.add('PROJECT', 'pry_kairos_app', 'Kairos App');
  world.invoices.add('inv_1', 'Factura 1', 'KAI-0001');
  world.payments.add('pay_1', 'Pago 1', 'PAG-0001');
  world.expenses.add('exp_1', 'Gasto 1', 'GAS-0001');
  const project = (id: string, code: string, clientIds: string[]) =>
    world.lookupSource.projects.set(id, {
      id,
      code,
      name: id,
      status: 'EN_CURSO',
      clientIds,
      archived: false,
    });
  project('pry_kairos_web', 'PRY-0001', ['cli_kairos']);
  project('pry_kairos_app', 'PRY-0002', ['cli_kairos']);
  return world;
}

export const newDocument = (over: Record<string, unknown> = {}) => ({
  title: 'NDA con Kairos',
  typeId: 'dtyp_nda',
  alertDaysBefore: 30,
  tagIds: [] as string[],
  links: [KAIROS] as readonly { entityType: 'CLIENT'; entityId: string }[],
  ...over,
});
