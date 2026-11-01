import { describe, expect, it } from 'vitest';
import {
  admin,
  member,
  newDocument,
  owner,
  seededWorld,
  viewer,
} from '../../../../../../test/documents/records/world';
import { ForbiddenError, NotFoundError } from '../../../../../shared/domain/domain-error';
import type { DocumentStatus } from '../../../../../shared/domain/enums';

// Behavioral spec: `setDocumentStatus` of fe/src/mocks/services/documents.ts (documents-lifecycle.test.ts, S6)
// and PRD §8.9.4 / HU-19 CA1.

const walk = async (
  world: ReturnType<typeof seededWorld>,
  id: string,
  statuses: readonly DocumentStatus[],
) => {
  for (const status of statuses) await world.setStatus.execute(owner, { id, status });
};

describe('SetDocumentStatus', () => {
  it('follows an allowed transition, reindexes and logs STATUS_CHANGE', async () => {
    const world = seededWorld();
    const doc = await world.createDocument.execute(owner, newDocument());
    world.clock.advance(60_000);

    const updated = await world.setStatus.execute(member, { id: doc.id, status: 'EN_REVISION' });

    expect(updated).toMatchObject({ status: 'EN_REVISION', updatedAt: world.clock.now() });
    expect(world.activity.entries.at(-1)).toMatchObject({
      action: 'STATUS_CHANGE',
      entityId: doc.id,
      clientId: 'cli_kairos',
      changes: { status: ['BORRADOR', 'EN_REVISION'] },
    });
    expect(world.search.get('DOCUMENT', doc.id)?.status).toBe('EN_REVISION');
    expect(world.locks.acquired).toEqual([{ rowClass: 'Document', id: doc.id }]);
    expect(world.uow.lastOptions).toEqual({ isolation: 'Serializable' });
  });

  it('walks BORRADOR to FIRMADO and back from EN_REVISION to BORRADOR', async () => {
    const world = seededWorld();
    const doc = await world.createDocument.execute(owner, newDocument());
    await walk(world, doc.id, ['EN_REVISION', 'BORRADOR', 'EN_REVISION', 'APROBADO', 'ENVIADO']);
    const signed = await world.setStatus.execute(owner, {
      id: doc.id,
      status: 'FIRMADO',
      signedAt: '2026-10-08',
    });
    expect(signed).toMatchObject({ status: 'FIRMADO', signedAt: '2026-10-08' });
    expect(world.activity.entries.at(-1)).toMatchObject({
      action: 'STATUS_CHANGE',
      changes: { status: ['ENVIADO', 'FIRMADO'], signedAt: [null, '2026-10-08'] },
    });
  });

  it('refuses a transition the table does not allow with its own message, and writes nothing', async () => {
    const world = seededWorld();
    const doc = await world.createDocument.execute(owner, newDocument());
    const entries = world.activity.entries.length;
    for (const status of ['APROBADO', 'ENVIADO', 'FIRMADO'] as const) {
      await expect(
        world.setStatus.execute(owner, { id: doc.id, status, signedAt: '2026-10-08' }),
      ).rejects.toMatchObject({
        code: 'VALIDATION',
        fieldErrors: { status: ['documents.errors.invalidTransition'] },
      });
    }
    expect(world.documents.rows[0]?.status).toBe('BORRADOR');
    expect(world.activity.entries).toHaveLength(entries);
  });

  it('VENCIDO is never set by a person', async () => {
    const world = seededWorld();
    const doc = await world.createDocument.execute(owner, newDocument());
    await expect(
      world.setStatus.execute(owner, { id: doc.id, status: 'VENCIDO' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { status: ['validation.invalidOption'] },
    });
  });

  it('ANULADO is final and VENCIDO has no way out, not even ANULADO', async () => {
    const world = seededWorld();
    const doc = await world.createDocument.execute(owner, newDocument());
    await world.setStatus.execute(owner, { id: doc.id, status: 'ANULADO' });
    await expect(
      world.setStatus.execute(owner, { id: doc.id, status: 'BORRADOR' }),
    ).rejects.toMatchObject({ fieldErrors: { status: ['documents.errors.invalidTransition'] } });

    const expired = world.seedDocument({ id: 'doc_old', typeId: 'dtyp_nda', status: 'VENCIDO' });
    await expect(
      world.setStatus.execute(owner, { id: expired.id, status: 'ANULADO' }),
    ).rejects.toMatchObject({ fieldErrors: { status: ['documents.errors.invalidTransition'] } });
  });

  it('FIRMADO needs a type with signature and the signature date, which it stores', async () => {
    const world = seededWorld();
    const plain = await world.createDocument.execute(owner, newDocument({ typeId: 'dtyp_nota' }));
    await walk(world, plain.id, ['EN_REVISION', 'APROBADO', 'ENVIADO']);
    await expect(
      world.setStatus.execute(owner, { id: plain.id, status: 'FIRMADO', signedAt: '2026-10-08' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { status: ['documents.validation.signedStatusNotAllowed'] },
    });

    const contract = await world.createDocument.execute(owner, newDocument());
    await walk(world, contract.id, ['EN_REVISION', 'APROBADO', 'ENVIADO']);
    await expect(
      world.setStatus.execute(owner, { id: contract.id, status: 'FIRMADO' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { signedAt: ['validation.required'] },
    });
  });

  it('refuses a signature date on a type without signature, whatever the status', async () => {
    const world = seededWorld();
    const doc = await world.createDocument.execute(owner, newDocument({ typeId: 'dtyp_nota' }));
    await expect(
      world.setStatus.execute(owner, { id: doc.id, status: 'EN_REVISION', signedAt: '2026-10-08' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { signedAt: ['documents.validation.signedAtNotAllowed'] },
    });
  });

  it('keeps the signature date when a signed document is voided', async () => {
    const world = seededWorld();
    const doc = await world.createDocument.execute(owner, newDocument());
    await walk(world, doc.id, ['EN_REVISION', 'APROBADO', 'ENVIADO']);
    await world.setStatus.execute(owner, { id: doc.id, status: 'FIRMADO', signedAt: '2026-10-08' });
    const voided = await world.setStatus.execute(owner, { id: doc.id, status: 'ANULADO' });
    expect(voided).toMatchObject({ status: 'ANULADO', signedAt: '2026-10-08' });
  });

  it('refuses a Viewer, an unknown document and an archived one', async () => {
    const world = seededWorld();
    const doc = await world.createDocument.execute(owner, newDocument());
    await expect(
      world.setStatus.execute(viewer, { id: doc.id, status: 'EN_REVISION' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      world.setStatus.execute(owner, { id: 'doc_missing', status: 'EN_REVISION' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await world.archiveDocument.execute(admin, { id: doc.id });
    await expect(
      world.setStatus.execute(owner, { id: doc.id, status: 'EN_REVISION' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
