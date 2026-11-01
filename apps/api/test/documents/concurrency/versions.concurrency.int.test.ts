import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FinanceLookups } from '../../../src/modules/commercial/application/finance-lookups';
import { NoteLinkTargetRegistry } from '../../../src/modules/commercial/application/note-link-target.registry';
import { PrismaFinanceLookups } from '../../../src/modules/commercial/infrastructure/prisma-finance-lookups';
import { PrismaNoteTargetAdapter } from '../../../src/modules/commercial/infrastructure/prisma-note-target.adapter';
import {
  DocumentSupport,
  DocumentViews,
} from '../../../src/modules/documents/application/document-support';
import type { DocumentRepository } from '../../../src/modules/documents/application/ports/document.repository.port';
import { PublishVersion } from '../../../src/modules/documents/application/use-cases/versions/publish-version.use-case';
import { RestoreVersion } from '../../../src/modules/documents/application/use-cases/versions/restore-version.use-case';
import { UploadVersion } from '../../../src/modules/documents/application/use-cases/versions/upload-version.use-case';
import { SetDocumentStatus } from '../../../src/modules/documents/application/use-cases/records/set-document-status.use-case';
import { PrismaDocumentRepository } from '../../../src/modules/documents/infrastructure/prisma-document.repository';
import { PrismaDocumentVersionRepository } from '../../../src/modules/documents/infrastructure/prisma-document-version.repository';
import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import { FileAccessRegistry } from '../../../src/modules/platform/application/file-access.registry';
import type { FileRepository } from '../../../src/modules/platform/application/ports/file.repository.port';
import { DeleteFile } from '../../../src/modules/platform/application/use-cases/delete-file.use-case';
import { ReserveFileForAttachment } from '../../../src/modules/platform/application/use-cases/reserve-file-for-attachment.use-case';
import { PrismaFileRepository } from '../../../src/modules/platform/infrastructure/prisma-file.repository';
import { DocumentTypeCatalog } from '../../../src/modules/settings/application/document-type-catalog';
import { TagAssignments } from '../../../src/modules/settings/application/tag-assignments';
import { PrismaDocumentCategoryRepository } from '../../../src/modules/settings/infrastructure/prisma-document-category.repository';
import { PrismaDocumentTypeRepository } from '../../../src/modules/settings/infrastructure/prisma-document-type.repository';
import { PrismaTagAssignmentRepository } from '../../../src/modules/settings/infrastructure/prisma-tag-assignment.repository';
import { PrismaTagRepository } from '../../../src/modules/settings/infrastructure/prisma-tag.repository';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import type { RowLocksPort } from '../../../src/shared/application/ports/row-locks.port';
import type { UnitOfWorkPort } from '../../../src/shared/application/ports/unit-of-work.port';
import { CuidGenerator } from '../../../src/shared/infrastructure/id-generator.adapter';
import { PrismaActivityLog } from '../../../src/shared/infrastructure/prisma/prisma-activity-log';
import { PrismaClientMetricsWriter } from '../../../src/shared/infrastructure/prisma/prisma-client-metrics-writer';
import { PrismaRowLocks } from '../../../src/shared/infrastructure/prisma/prisma-row-locks';
import { PrismaSearchIndex } from '../../../src/shared/infrastructure/prisma/prisma-search-index';
import { PrismaUnitOfWork } from '../../../src/shared/infrastructure/prisma/prisma-unit-of-work';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../src/shared/infrastructure/prisma/transaction-host';
import { SystemClock } from '../../../src/shared/infrastructure/system-clock.adapter';
import { InMemoryFileStorage } from '../../support/fakes/in-memory-file-storage';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { Gate, gated, interleave, noLocks, readCommitted } from './world';

/**
 * Concurrent version writes over real PostgreSQL (lessons B3, M1; DT-126, DT-146). The first transaction is
 * paused once it holds what it read and before it commits; the second one then runs. With the `Document` row
 * lock and `Serializable` the second waits and reads the committed state; without them the two work on a stale
 * read: two publishes take the same number, a version lands on a document signed meanwhile, a file is attached
 * while it is deleted.
 */
const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });

let owner: CurrentUser;

interface Hooks {
  /** Decorates the document repository (pause before a write). */
  documents?: (repository: DocumentRepository) => DocumentRepository;
  /** Pauses after the `max(versionNumber)` read of `appendVersion`: both writers hold the same number. */
  pauseAfterNumbering?: Gate;
  locks?: (locks: RowLocksPort) => RowLocksPort;
  uow?: (uow: UnitOfWorkPort) => UnitOfWorkPort;
  files?: (files: FileRepository) => FileRepository;
}

/** A `TransactionHost` whose `documentVersion.aggregate` pauses once at `gate`, after the real read. */
function pausedNumbering(host: TransactionHost, gate: Gate): TransactionHost {
  return Object.create(host, {
    db: {
      get: () =>
        new Proxy(host.db, {
          get(target, prop) {
            const value: unknown = Reflect.get(target, prop);
            return prop === 'documentVersion'
              ? gated(value as object, gate, ['aggregate'], 'after')
              : value;
          },
        }),
    },
  }) as TransactionHost;
}

function buildWorld(hooks: Hooks = {}) {
  const host = new TransactionHost(service);
  const uow = (hooks.uow ?? ((u) => u))(new PrismaUnitOfWork(host));
  const authorization = new MatrixAuthorization();
  const clock = new SystemClock();
  const documentsHost = hooks.pauseAfterNumbering
    ? pausedNumbering(host, hooks.pauseAfterNumbering)
    : host;
  const documents = (hooks.documents ?? ((d) => d))(new PrismaDocumentRepository(documentsHost));
  const versions = new PrismaDocumentVersionRepository(host);
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
  const registry = new FileAccessRegistry();
  const fileRepository = (hooks.files ?? ((f) => f))(new PrismaFileRepository(host));
  const support = new DocumentSupport(
    documents,
    catalog,
    targets,
    new FinanceLookups(new PrismaFinanceLookups(host)),
    authorization,
    new ReserveFileForAttachment(authorization, fileRepository, registry),
    activity,
    search,
    locks,
    clock,
    new CuidGenerator(),
  );
  const views = new DocumentViews(documents, tags, catalog, targets, authorization, clock);
  return {
    publish: new PublishVersion(authorization, uow, support, versions, views),
    upload: new UploadVersion(authorization, uow, support, views),
    restore: new RestoreVersion(authorization, uow, support, versions, views),
    setStatus: new SetDocumentStatus(authorization, uow, support, views),
    deleteFile: new DeleteFile(
      authorization,
      fileRepository,
      registry,
      new InMemoryFileStorage(),
      activity,
      uow,
      clock,
      () => undefined,
    ),
  };
}

/** The unlocked behavior, applied to the world under test as well as to the one racing it. */
const UNLOCKED: Hooks = { locks: noLocks, uow: readCommitted };

beforeAll(() => truncateBusinessTables(admin), 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  await truncateBusinessTables(admin);
  const row = await admin.user.create({
    data: { clerkId: 'user_ver_conc', email: 'conc@example.test', name: 'Owner', role: 'OWNER' },
  });
  owner = { userId: row.id, clerkId: row.clerkId, role: 'OWNER', email: row.email, name: 'Owner' };
  await admin.client.create({
    data: {
      id: 'cli_a',
      code: 'CLI-0001',
      kind: 'EMPRESA',
      tradeName: 'Kairos',
      legalName: 'Kairos C.A.',
      taxId: 'J-1',
      country: 'VE',
      address: 'Av. Principal',
      phone: '+584121234567',
      metrics: { create: {} },
    },
  });
}, 60_000);

const seedFile = (id: string) =>
  admin.file.create({
    data: {
      id,
      storageKey: `general/2026/10/${id}`,
      bucket: 'test',
      originalName: `${id}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 10,
      status: 'READY',
      uploadedById: owner.userId,
    },
  });

/** A live document of `typeId` with a markdown `ver_1` as its current version. */
async function seedDocument(typeId: string, status: 'BORRADOR' | 'ENVIADO' = 'BORRADOR') {
  await admin.document.create({
    data: {
      id: 'doc_a',
      code: 'DOC-0001',
      title: 'Documento',
      typeId,
      status,
      createdById: owner.userId,
      links: { create: [{ clientId: 'cli_a' }] },
    },
  });
  await admin.documentVersion.create({
    data: {
      id: 'ver_1',
      documentId: 'doc_a',
      versionNumber: 1,
      format: 'MARKDOWN',
      content: '# v1',
      createdById: owner.userId,
    },
  });
  await admin.document.update({ where: { id: 'doc_a' }, data: { currentVersionId: 'ver_1' } });
}

const versionsOf = () =>
  admin.documentVersion.findMany({
    where: { documentId: 'doc_a' },
    orderBy: { versionNumber: 'asc' },
  });

describe('two publishes of one document', () => {
  async function twoPublishes(hooks: Hooks) {
    await seedDocument('dtyp_prd');
    const gate = new Gate();
    const slow = buildWorld({ ...hooks, pauseAfterNumbering: gate });
    const fast = buildWorld(hooks);
    const results = await interleave(
      admin,
      gate,
      () => slow.publish.execute(owner, { documentId: 'doc_a', content: '# slow' }),
      () => fast.publish.execute(owner, { documentId: 'doc_a', content: '# fast' }),
    );
    const row = await admin.document.findUniqueOrThrow({ where: { id: 'doc_a' } });
    return { results, versions: await versionsOf(), row };
  }

  it('get consecutive numbers, one current version and no error for either caller', async () => {
    const { results, versions, row } = await twoPublishes({});
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(versions.map((version) => version.versionNumber)).toEqual([1, 2, 3]);
    expect(row.currentVersionId).toBe(versions[2]?.id);
    expect(await admin.activityLog.count({ where: { action: 'VERSION_PUBLISH' } })).toBe(2);
  });

  it('control: with no lock and ReadCommitted both take the same number and one fails', async () => {
    const { results, versions } = await twoPublishes(UNLOCKED);
    expect(results.map((result) => result.status)).toContain('rejected');
    expect(versions).toHaveLength(2);
  });
});

describe('publishVersion vs setDocumentStatus FIRMADO (DT-138)', () => {
  const SIGN = { id: 'doc_a', status: 'FIRMADO' as const, signedAt: '2026-10-30' };

  /** The version lock holds whichever won: no version is written to a document after it was signed. */
  async function outcome(results: PromiseSettledResult<unknown>[]) {
    const log = await admin.activityLog.findMany({
      where: { entityId: 'doc_a', action: { in: ['VERSION_PUBLISH', 'STATUS_CHANGE'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return {
      results,
      log: log.map((entry) => entry.action),
      row: await admin.document.findUniqueOrThrow({ where: { id: 'doc_a' } }),
      versions: await versionsOf(),
    };
  }
  const expectLocked = (done: Awaited<ReturnType<typeof outcome>>) => {
    const signedAt = done.log.indexOf('STATUS_CHANGE');
    expect(done.row.status).toBe('FIRMADO');
    expect(signedAt).toBeGreaterThanOrEqual(0);
    expect(done.log.slice(signedAt)).not.toContain('VERSION_PUBLISH');
  };

  async function publishFirst(hooks: Hooks) {
    await seedDocument('dtyp_nda', 'ENVIADO');
    const gate = new Gate();
    const slow = buildWorld({ ...hooks, pauseAfterNumbering: gate });
    const fast = buildWorld(hooks);
    return outcome(
      await interleave(
        admin,
        gate,
        () => slow.publish.execute(owner, { documentId: 'doc_a', content: '# v2' }),
        () => fast.setStatus.execute(owner, SIGN),
      ),
    );
  }

  async function signFirst(hooks: Hooks) {
    await seedDocument('dtyp_nda', 'ENVIADO');
    const gate = new Gate();
    const slow = buildWorld({
      ...hooks,
      documents: (repository) => gated(repository, gate, ['setStatus'], 'before'),
    });
    const fast = buildWorld(hooks);
    return outcome(
      await interleave(
        admin,
        gate,
        () => slow.setStatus.execute(owner, SIGN),
        () => fast.publish.execute(owner, { documentId: 'doc_a', content: '# v2' }),
      ),
    );
  }

  it('a publish that holds the lock first is followed by the signature', async () => {
    const done = await publishFirst({});
    expect(done.results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(done.log).toEqual(['VERSION_PUBLISH', 'STATUS_CHANGE']);
    expect(done.versions).toHaveLength(2);
    expectLocked(done);
  });

  it('a signature that holds the lock first makes the publish INTEGRITY_LOCK', async () => {
    const done = await signFirst({});
    const [signed, published] = done.results;
    expect(signed?.status).toBe('fulfilled');
    expect(published).toMatchObject({ status: 'rejected', reason: { code: 'INTEGRITY_LOCK' } });
    expect(done.versions).toHaveLength(1);
    expectLocked(done);
  });

  it('control: with no lock and ReadCommitted a signature lands while a publish in flight is about to write its version', async () => {
    const stale = await publishFirst(UNLOCKED);
    expect(stale.results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(() => expectLocked(stale)).toThrow();
  });
});

describe('uploadVersion vs restoreVersion of one document', () => {
  async function restoreVsUpload(hooks: Hooks) {
    await seedDocument('dtyp_prd');
    const gate = new Gate();
    const slow = buildWorld({ ...hooks, pauseAfterNumbering: gate });
    const fast = buildWorld(hooks);
    const results = await interleave(
      admin,
      gate,
      () => slow.restore.execute(owner, { documentId: 'doc_a', versionId: 'ver_1' }),
      () =>
        fast.upload.execute(owner, {
          documentId: 'doc_a',
          format: 'ENLACE',
          url: 'https://vault.example.com/a',
        }),
    );
    const row = await admin.document.findUniqueOrThrow({ where: { id: 'doc_a' } });
    return { results, versions: await versionsOf(), row };
  }

  it('number the new versions consecutively, whichever commits first', async () => {
    const { results, versions, row } = await restoreVsUpload({});
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(versions.map((version) => version.versionNumber)).toEqual([1, 2, 3]);
    expect(row.currentVersionId).toBe(versions[2]?.id);
    expect(versions.map((version) => version.format).sort()).toEqual([
      'ENLACE',
      'MARKDOWN',
      'MARKDOWN',
    ]);
  });

  it('control: with no lock and ReadCommitted they take the same number and one fails', async () => {
    const { results, versions } = await restoreVsUpload(UNLOCKED);
    expect(results.map((result) => result.status)).toContain('rejected');
    expect(versions).toHaveLength(2);
  });
});

describe('uploadVersion vs DeleteFile of the same file (lesson of BE-1, C23)', () => {
  /** Whatever won, no version holds a file that was deleted. */
  async function state() {
    const file = await admin.file.findUniqueOrThrow({ where: { id: 'fil_a' } });
    return { file, held: await admin.documentVersion.count({ where: { fileId: 'fil_a' } }) };
  }

  async function uploadFirst(hooks: Hooks) {
    await seedFile('fil_a');
    await seedDocument('dtyp_nda');
    const gate = new Gate();
    const slow = buildWorld({ ...hooks, pauseAfterNumbering: gate });
    const fast = buildWorld({ uow: hooks.uow });
    const results = await interleave(
      admin,
      gate,
      () => slow.upload.execute(owner, { documentId: 'doc_a', format: 'ARCHIVO', fileId: 'fil_a' }),
      () => fast.deleteFile.execute(owner, { fileId: 'fil_a' }),
    );
    return { results, ...(await state()) };
  }

  it('a delete that waits for the attach finds the file referenced (INTEGRITY_LOCK)', async () => {
    const done = await uploadFirst({});
    const [upload, deletion] = done.results;
    expect(upload?.status).toBe('fulfilled');
    expect(deletion).toMatchObject({ status: 'rejected', reason: { code: 'INTEGRITY_LOCK' } });
    expect(done.held).toBe(1);
    expect(done.file.deletedAt).toBeNull();
  });

  it('control: with no File row lock the delete wins and the version holds a deleted file', async () => {
    const done = await uploadFirst({
      uow: readCommitted,
      files: (files) =>
        new Proxy(files, {
          get: (target, prop) =>
            prop === 'lockForUpdate' ? target.findById.bind(target) : Reflect.get(target, prop),
        }),
    });
    expect(done.results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(done.held).toBe(1);
    expect(done.file.deletedAt).not.toBeNull();
  });

  it('an attach that waits for a delete finds no file (NOT_FOUND) and writes no version', async () => {
    await seedFile('fil_a');
    await seedDocument('dtyp_nda');
    const gate = new Gate();
    const slow = buildWorld({ files: (files) => gated(files, gate, ['softDelete'], 'after') });
    const fast = buildWorld();
    const results = await interleave(
      admin,
      gate,
      () => slow.deleteFile.execute(owner, { fileId: 'fil_a' }),
      () => fast.upload.execute(owner, { documentId: 'doc_a', format: 'ARCHIVO', fileId: 'fil_a' }),
    );
    const done = await state();
    expect(results[0].status).toBe('fulfilled');
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'NOT_FOUND' } });
    expect(done.held).toBe(0);
    expect(done.file.deletedAt).not.toBeNull();
  });
});
