import { describe, expect, it } from 'vitest';
import {
  ANA,
  EXPENSE_1,
  INVOICE_1,
  KAIROS,
  KAIROS_WEB,
  PAYMENT_1,
  SOLARIS,
  admin,
  member,
  newDocument,
  owner,
  seededWorld,
  viewer,
} from '../../../../../../test/documents/records/world';
import { ForbiddenError, NotFoundError } from '../../../../../shared/domain/domain-error';

// Behavioral spec: `linkDocument` / `unlinkDocument` of fe/src/mocks/services/documents.ts (documents.test.ts)
// and HU-20 CA1-CA2, DT-142.

const setup = async () => {
  const world = seededWorld();
  const doc = await world.createDocument.execute(owner, newDocument({ links: [KAIROS] }));
  return { world, doc };
};

describe('LinkDocument', () => {
  it('links a record of each of the six types and returns every link, resolved', async () => {
    const { world, doc } = await setup();
    let links = await world.linkDocument.execute(owner, { documentId: doc.id, target: KAIROS_WEB });
    for (const target of [ANA, INVOICE_1, PAYMENT_1, EXPENSE_1]) {
      links = await world.linkDocument.execute(owner, { documentId: doc.id, target });
    }
    expect(links.map((l) => l.entity.type)).toEqual([
      'CLIENT',
      'PROJECT',
      'CONTACT',
      'INVOICE',
      'PAYMENT',
      'EXPENSE',
    ]);
    expect(world.activity.entries.filter((e) => e.action === 'LINK')).toHaveLength(6);
    expect(world.activity.entries.at(-1)?.metadata).toEqual({
      entityType: 'EXPENSE',
      entityId: 'exp_1',
    });
    expect(world.locks.acquired).toEqual([{ rowClass: 'Document', id: doc.id }]);
    expect(world.uow.lastOptions).toEqual({ isolation: 'Serializable' });
  });

  it('is idempotent: a repeated target changes nothing and writes no entry', async () => {
    const { world, doc } = await setup();
    const entries = world.activity.entries.length;
    const links = await world.linkDocument.execute(owner, { documentId: doc.id, target: KAIROS });
    expect(links).toHaveLength(1);
    expect(world.activity.entries).toHaveLength(entries);
    expect(world.documents.committedLinks(doc.id)).toHaveLength(1);
  });

  it('refuses an unknown or archived record, an unknown or archived document', async () => {
    const { world, doc } = await setup();
    await expect(
      world.linkDocument.execute(owner, {
        documentId: doc.id,
        target: { entityType: 'CLIENT', entityId: 'cli_missing' },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    world.noteTargets.archive('CLIENT', 'cli_solaris');
    await expect(
      world.linkDocument.execute(owner, { documentId: doc.id, target: SOLARIS }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.linkDocument.execute(owner, { documentId: 'doc_missing', target: ANA }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await world.archiveDocument.execute(admin, { id: doc.id });
    await expect(
      world.linkDocument.execute(owner, { documentId: doc.id, target: ANA }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses DOCUMENT as a target', async () => {
    const { world, doc } = await setup();
    await expect(
      world.linkDocument.execute(owner, {
        documentId: doc.id,
        target: { entityType: 'DOCUMENT', entityId: doc.id } as never,
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { entityType: ['validation.invalidOption'] },
    });
  });

  it('a Member links clients but gets NOT_FOUND for a financial record (DT-142); a Viewer is FORBIDDEN', async () => {
    const { world, doc } = await setup();
    await world.linkDocument.execute(member, { documentId: doc.id, target: ANA });
    await expect(
      world.linkDocument.execute(member, { documentId: doc.id, target: INVOICE_1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.linkDocument.execute(viewer, { documentId: doc.id, target: ANA }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('leaves out of the answer the chips the caller cannot read (DT-142)', async () => {
    const { world, doc } = await setup();
    await world.linkDocument.execute(owner, { documentId: doc.id, target: INVOICE_1 });
    const asMember = await world.linkDocument.execute(member, { documentId: doc.id, target: ANA });
    expect(asMember.map((l) => l.entity.type)).toEqual(['CLIENT', 'CONTACT']);
  });
});

describe('UnlinkDocument', () => {
  it('removes one link, keeps the others and the document, and logs UNLINK with the target', async () => {
    const { world, doc } = await setup();
    await world.linkDocument.execute(owner, { documentId: doc.id, target: KAIROS_WEB });

    const links = await world.unlinkDocument.execute(owner, {
      documentId: doc.id,
      target: KAIROS_WEB,
    });

    expect(links.map((l) => l.entity.id)).toEqual(['cli_kairos']);
    expect(world.documents.committedLinks(doc.id)).toHaveLength(1);
    expect(world.documents.rows[0]?.deletedAt).toBeNull();
    expect(world.activity.entries.at(-1)).toMatchObject({
      action: 'UNLINK',
      metadata: { entityType: 'PROJECT', entityId: 'pry_kairos_web' },
      clientId: 'cli_kairos',
    });
  });

  it('keeps the client scope of the link it removes on the UNLINK entry', async () => {
    const { world, doc } = await setup();
    await world.unlinkDocument.execute(owner, { documentId: doc.id, target: KAIROS });
    expect(world.activity.entries.at(-1)).toMatchObject({
      action: 'UNLINK',
      clientId: 'cli_kairos',
      touchClientIds: ['cli_kairos'],
    });
    expect(world.documents.committedLinks(doc.id)).toEqual([]);
  });

  it('writes nothing when the document is not linked to that record', async () => {
    const { world, doc } = await setup();
    const entries = world.activity.entries.length;
    const links = await world.unlinkDocument.execute(owner, { documentId: doc.id, target: ANA });
    expect(links).toHaveLength(1);
    expect(world.activity.entries).toHaveLength(entries);
  });

  it('answers NOT_FOUND for an unknown or archived document and for a type the caller cannot read', async () => {
    const { world, doc } = await setup();
    await expect(
      world.unlinkDocument.execute(owner, { documentId: 'doc_missing', target: KAIROS }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.unlinkDocument.execute(member, { documentId: doc.id, target: INVOICE_1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await world.archiveDocument.execute(admin, { id: doc.id });
    await expect(
      world.unlinkDocument.execute(owner, { documentId: doc.id, target: KAIROS }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses a Viewer', async () => {
    const { world, doc } = await setup();
    await expect(
      world.unlinkDocument.execute(viewer, { documentId: doc.id, target: KAIROS }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
