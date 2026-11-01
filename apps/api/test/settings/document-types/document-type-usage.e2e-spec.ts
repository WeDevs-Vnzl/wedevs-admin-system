import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentRecordsModule } from '../../../src/modules/documents/document-records.module';
import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import { FILE_STORAGE } from '../../../src/modules/platform/application/ports/file-storage.port';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { AUTHORIZATION } from '../../../src/shared/application/ports/tokens';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { InMemoryFileStorage } from '../../support/fakes/in-memory-file-storage';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';
import { createTestApp } from '../../support/test-app';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const TYPES = '/api/v1/document-types';
const DOCUMENTS = '/api/v1/documents';
const TYPE_IN_USE = 'catalogs.documentTypes.errors.typeInUse';

/** The usage port bound to the real `Document` table (DT-110), through the public routes. */
describe('document type usage (e2e): HU-21 CA1, CA2 and the delete race', () => {
  const prisma = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));
  const authenticator = new FakeAuthenticator();
  let app: NestExpressApplication;
  let ownerToken = '';

  beforeAll(async () => {
    app = await createTestApp({
      modules: [DocumentRecordsModule],
      authenticator,
      overrides: [
        { token: AUTHORIZATION, useValue: new MatrixAuthorization() },
        { token: FILE_STORAGE, useValue: new InMemoryFileStorage() },
      ],
    });
  });
  beforeEach(async () => {
    await truncateBusinessTables(prisma);
    const row = await prisma.user.create({
      data: { clerkId: 'clerk_usage', email: 'usage@example.test', name: 'Owner', role: 'OWNER' },
    });
    const owner: CurrentUser = {
      userId: row.id,
      clerkId: row.clerkId,
      role: 'OWNER',
      email: row.email,
      name: row.name,
    };
    ownerToken = authenticator.issue(owner);
    await prisma.client.create({
      data: {
        id: 'cli_usage',
        code: 'CLI-0001',
        kind: 'EMPRESA',
        tradeName: 'Kairos',
        legalName: 'Kairos SA',
        taxId: 'J-1',
        country: 'VE',
        address: 'x',
        phone: '1',
      },
    });
  });
  afterAll(async () => {
    await app.close();
    await truncateBusinessTables(prisma);
    await prisma.$disconnect();
  });

  const http = () => request(app.getHttpServer());
  const auth = () => `Bearer ${ownerToken}`;
  /** Catalog tables survive `truncateBusinessTables`, so each type gets a name of its own. */
  let typeSeq = 0;
  const createType = () =>
    http()
      .post(TYPES)
      .set('Authorization', auth())
      .send({
        categoryId: 'dcat_legal',
        name: `Acta ${(typeSeq += 1)}`,
        requiresSignature: false,
        hasExpiration: false,
        defaultFormat: 'MARKDOWN',
      });
  const createDocument = (typeId: string) =>
    http()
      .post(DOCUMENTS)
      .set('Authorization', auth())
      .send({
        title: 'Acuerdo',
        typeId,
        links: [{ entityType: 'CLIENT', entityId: 'cli_usage' }],
      });
  const deleteType = (id: string) => http().delete(`${TYPES}/${id}`).set('Authorization', auth());

  it('HU-21 CA1: a type just created is usable at once and reports no documents', async () => {
    const type = await createType().expect(201);
    expect(type.body).toMatchObject({
      name: expect.stringMatching(/^Acta \d+$/),
      active: true,
      documentCount: 0,
    });

    await createDocument(type.body.id).expect(201);

    const read = await http()
      .get(`${TYPES}/${type.body.id}`)
      .set('Authorization', auth())
      .expect(200);
    expect(read.body.documentCount).toBe(1);
  });

  it('HU-21 CA2: a type in use cannot be deleted, can be deactivated, and then refuses new documents', async () => {
    const type = await createType().expect(201);
    await createDocument(type.body.id).expect(201);

    const locked = await deleteType(type.body.id).expect(409);
    expect(locked.body.error).toMatchObject({ code: 'INTEGRITY_LOCK', message: TYPE_IN_USE });
    await expect(prisma.documentType.count({ where: { id: type.body.id } })).resolves.toBe(1);

    await http()
      .post(`${TYPES}/${type.body.id}/active`)
      .set('Authorization', auth())
      .send({ active: false })
      .expect(200);
    const refused = await createDocument(type.body.id).expect(422);
    expect(refused.body.error.fieldErrors).toEqual({ typeId: ['validation.invalidOption'] });
    await expect(prisma.document.count({ where: { typeId: type.body.id } })).resolves.toBe(1);
  });

  it('counts archived documents: a type whose only document is archived stays locked', async () => {
    const type = await createType().expect(201);
    const doc = await createDocument(type.body.id).expect(201);
    await http()
      .post(`${DOCUMENTS}/${doc.body.id}/archive`)
      .set('Authorization', auth())
      .send({})
      .expect(200);
    await expect(
      prisma.document.count({ where: { typeId: type.body.id, deletedAt: { not: null } } }),
    ).resolves.toBe(1);

    const locked = await deleteType(type.body.id).expect(409);
    expect(locked.body.error).toMatchObject({ code: 'INTEGRITY_LOCK', message: TYPE_IN_USE });
    await expect(prisma.documentType.count({ where: { id: type.body.id } })).resolves.toBe(1);
  });

  it('a delete that races a document being created answers typeInUse, never a 500', async () => {
    const type = await createType().expect(201);
    const typeId: string = type.body.id;
    const author = await prisma.user.findFirstOrThrow({ where: { clerkId: 'clerk_usage' } });

    // The competing create: its insert is in flight (uncommitted) and holds the FK share lock on the type.
    let commit!: () => void;
    const mayCommit = new Promise<void>((resolve) => (commit = resolve));
    let inserted!: () => void;
    const hasInserted = new Promise<void>((resolve) => (inserted = resolve));
    const creating = prisma.$transaction(async (tx) => {
      await tx.document.create({
        data: {
          id: 'doc_race',
          code: 'DOC-RACE',
          title: 'Carrera',
          typeId,
          createdById: author.id,
        },
      });
      inserted();
      await mayCommit;
    });
    await hasInserted;

    const deleting = deleteType(typeId).then((res) => res);
    await untilSomeoneWaitsOnALock(prisma);
    commit();
    await creating;
    const res = await deleting;

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'INTEGRITY_LOCK', message: TYPE_IN_USE });
    await expect(prisma.documentType.count({ where: { id: typeId } })).resolves.toBe(1);
    await expect(prisma.document.count({ where: { id: 'doc_race' } })).resolves.toBe(1);
    await expect(
      prisma.activityLog.count({ where: { entityId: typeId, action: 'SETTINGS_CHANGE' } }),
    ).resolves.toBe(1); // the type's own creation only; the failed delete logged nothing
  });
});

/** Polls `pg_stat_activity` until a backend waits on a lock. */
async function untilSomeoneWaitsOnALock(db: ReturnType<typeof createTestPrisma>): Promise<void> {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    const rows = await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (rows[0] && rows[0].n > 0n) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('nobody waited on a lock');
}
