import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaDocumentTypeSearchDependents } from '../../../src/modules/documents/infrastructure/document-type-search-dependents.adapter';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { PrismaSearchIndex } from '../../../src/shared/infrastructure/prisma/prisma-search-index';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { PrismaUnitOfWork } from '../../../src/shared/infrastructure/prisma/prisma-unit-of-work';
import { TransactionHost } from '../../../src/shared/infrastructure/prisma/transaction-host';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import {
  buildDocumentWorld,
  Gate,
  gated,
  interleave,
  readCommitted,
  type DocumentWorldHooks,
} from './world';

/**
 * A document mutation against the rename of its type (DT-166, X18), over real PostgreSQL. The mutation reads
 * the type name, pauses before it writes the document's `SearchEntry`, and the rename (type row plus
 * dependants, one `Serializable` unit of work, the shape package 4.5 gives `UpdateDocumentType`) runs and
 * commits meanwhile. The entry must end with the new name: the stale writer is aborted by PostgreSQL and
 * retried, or answers `CONFLICT`, never a 500. The control runs both at `ReadCommitted` (today's rename flow)
 * to show the interleaving can lose the new name.
 */
const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });

let owner: CurrentUser;

beforeAll(() => truncateBusinessTables(admin), 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  await truncateBusinessTables(admin);
  const row = await admin.user.create({
    data: { clerkId: 'user_doc_dep', email: 'dep@example.test', name: 'Owner', role: 'OWNER' },
  });
  owner = { userId: row.id, clerkId: row.clerkId, role: 'OWNER', email: row.email, name: 'Owner' };
  const category = await admin.documentCategory.findFirstOrThrow();
  await admin.documentType.upsert({
    where: { id: 'dtyp_dep' },
    update: { name: 'Contrato', hasExpiration: false, requiresSignature: false },
    create: { id: 'dtyp_dep', name: 'Contrato', categoryId: category.id },
  });
  await admin.document.create({
    data: {
      id: 'doc_dep',
      code: 'DOC-DEP',
      title: 'Acuerdo',
      typeId: 'dtyp_dep',
      createdById: owner.userId,
    },
  });
  await admin.searchEntry.create({
    data: {
      entityType: 'DOCUMENT',
      entityId: 'doc_dep',
      code: 'DOC-DEP',
      title: 'Acuerdo',
      subtitle: 'Contrato',
      status: 'BORRADOR',
      archived: false,
    },
  });
}, 60_000);

/** The rename's unit of work: the type row and its dependants together (X18). */
function renameType(hooks: DocumentWorldHooks, name: string) {
  const host = new TransactionHost(service);
  const uow = (hooks.uow ?? ((u) => u))(new PrismaUnitOfWork(host));
  const dependents = new PrismaDocumentTypeSearchDependents(host, new PrismaSearchIndex(host));
  return uow.run(
    async () => {
      await host.requireTransaction('renameType').documentType.update({
        where: { id: 'dtyp_dep' },
        data: { name },
      });
      await dependents.relabelType('dtyp_dep', name);
    },
    { isolation: 'Serializable' },
  );
}

async function mutationVsRename(hooks: DocumentWorldHooks) {
  const gate = new Gate();
  const slow = buildDocumentWorld(service, {
    ...hooks,
    documents: (repository) => gated(repository, gate, ['currentMarkdown'], 'before'),
  });
  const results = await interleave(
    admin,
    gate,
    () => slow.setStatus.execute(owner, { id: 'doc_dep', status: 'EN_REVISION' }),
    () => renameType(hooks, 'Contrato marco'),
  );
  return {
    results,
    entry: await admin.searchEntry.findFirstOrThrow({
      where: { entityType: 'DOCUMENT', entityId: 'doc_dep' },
    }),
    type: await admin.documentType.findUniqueOrThrow({ where: { id: 'dtyp_dep' } }),
  };
}

describe('document mutation vs rename of its type', () => {
  it('ends with the new name on the entry: the stale writer retries or answers CONFLICT', async () => {
    const { results, entry, type } = await mutationVsRename({});
    const [mutation, rename] = results;
    expect(rename.status).toBe('fulfilled');
    expect(type.name).toBe('Contrato marco');
    if (mutation.status === 'rejected') {
      expect(mutation.reason).toMatchObject({ code: 'CONFLICT' });
      expect(entry.subtitle).toBe('Contrato marco');
      return;
    }
    expect(entry).toMatchObject({ subtitle: 'Contrato marco', status: 'EN_REVISION' });
  });

  it('control: at ReadCommitted the mutation writes the old name over the rename', async () => {
    const { results, entry, type } = await mutationVsRename({ uow: readCommitted });
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(type.name).toBe('Contrato marco');
    expect(entry.subtitle).toBe('Contrato');
  });
});
