import { describe, expect, it, vi } from 'vitest';
import { admin, owner, seededWorld } from '../../../../../../test/documents/records/world';
import type { Actor } from '../../../../../shared/application/actor';
import { actorOf } from '../../../../../shared/application/actor';
import { ConflictError, ForbiddenError } from '../../../../../shared/domain/domain-error';

// Behavioral spec: step 2 of `daily-maintenance` (PRD §12, HU-19 CA3) under DT-138, DT-129, DT-130.
// The clock is fixed at 2026-10-30T12:00Z, the Caracas day 2026-10-30.

const SYSTEM: Actor = { actorType: 'SYSTEM', userId: null };

const seed = (world: ReturnType<typeof seededWorld>) => {
  const doc = (id: string, over: Record<string, unknown>) =>
    world.seedDocument({ id, typeId: 'dtyp_nda', ...over });
  return {
    draft: doc('doc_draft', { expiresAt: '2026-10-29' }),
    sent: doc('doc_sent', { expiresAt: '2026-01-01', status: 'ENVIADO' }),
    signed: doc('doc_signed', {
      expiresAt: '2026-10-01',
      status: 'FIRMADO',
      signedAt: '2026-09-01',
    }),
    today: doc('doc_today', { expiresAt: '2026-10-30' }),
    future: doc('doc_future', { expiresAt: '2026-10-31' }),
    none: doc('doc_none', {}),
    voided: doc('doc_voided', { expiresAt: '2026-01-01', status: 'ANULADO' }),
    expired: doc('doc_expired', { expiresAt: '2026-01-01', status: 'VENCIDO' }),
    archived: doc('doc_archived', { expiresAt: '2026-01-01', deletedAt: new Date('2026-10-01') }),
  };
};

describe('MarkExpiredDocuments', () => {
  it('marks every live, expired document except ANULADO and VENCIDO ones (DT-138)', async () => {
    const world = seededWorld();
    seed(world);

    const result = await world.markExpired.execute(SYSTEM);

    expect(result).toEqual({
      updated: 3,
      documentIds: ['doc_draft', 'doc_sent', 'doc_signed'],
      skippedIds: [],
    });
    const statusOf = (id: string) => world.documents.rows.find((row) => row.id === id)?.status;
    expect(['doc_draft', 'doc_sent', 'doc_signed'].map(statusOf)).toEqual([
      'VENCIDO',
      'VENCIDO',
      'VENCIDO',
    ]);
    expect(
      ['doc_today', 'doc_future', 'doc_none', 'doc_voided', 'doc_archived'].map(statusOf),
    ).toEqual(['BORRADOR', 'BORRADOR', 'BORRADOR', 'ANULADO', 'BORRADOR']);
    // A signed document keeps its signature date: the version lock still applies (PRD:902).
    expect(world.documents.rows.find((row) => row.id === 'doc_signed')?.signedAt).toBe(
      '2026-09-01',
    );
  });

  it('records SYSTEM_JOB with { from, to } per document and reindexes the status', async () => {
    const world = seededWorld();
    world.seedDocument({
      id: 'doc_sent',
      typeId: 'dtyp_nda',
      expiresAt: '2026-01-01',
      status: 'ENVIADO',
    });

    await world.markExpired.execute(SYSTEM);

    expect(world.activity.entries).toEqual([
      expect.objectContaining({
        actor: { actorType: 'SYSTEM', userId: null },
        action: 'SYSTEM_JOB',
        entityType: 'DOCUMENT',
        entityId: 'doc_sent',
        metadata: { from: 'ENVIADO', to: 'VENCIDO' },
      }),
    ]);
    expect(world.search.get('DOCUMENT', 'doc_sent')).toMatchObject({
      status: 'VENCIDO',
      subtitle: 'NDA',
    });
    expect(world.uow.lastOptions).toEqual({ isolation: 'Serializable' });
    expect(world.locks.acquired).toEqual([{ rowClass: 'Document', id: 'doc_sent' }]);
  });

  it('scopes the entry to the client of the document links', async () => {
    const world = seededWorld();
    const doc = await world.createDocument.execute(owner, {
      title: 'NDA',
      typeId: 'dtyp_nda',
      alertDaysBefore: 30,
      tagIds: [],
      links: [{ entityType: 'CLIENT', entityId: 'cli_kairos' }],
      expiresAt: '2026-11-15',
    });
    world.clock.set('2026-11-16T12:00:00.000Z');

    await world.markExpired.execute(SYSTEM);

    expect(world.activity.entries.at(-1)).toMatchObject({
      action: 'SYSTEM_JOB',
      entityId: doc.id,
      clientId: 'cli_kairos',
    });
  });

  it('a rerun changes nothing', async () => {
    const world = seededWorld();
    seed(world);
    await world.markExpired.execute(SYSTEM);
    const entries = world.activity.entries.length;
    const writes = world.documents.writeCount;

    const again = await world.markExpired.execute(SYSTEM);

    expect(again).toEqual({ updated: 0, documentIds: [], skippedIds: [] });
    expect(world.activity.entries).toHaveLength(entries);
    expect(world.documents.writeCount).toBe(writes);
  });

  it('uses the Caracas business day: a document expiring today is not yet expired', async () => {
    const world = seededWorld();
    world.seedDocument({ id: 'doc_edge', typeId: 'dtyp_nda', expiresAt: '2026-10-30' });
    // 2026-10-31T02:00Z is still 2026-10-30 in Caracas (UTC-4).
    world.clock.set('2026-10-31T02:00:00.000Z');
    expect((await world.markExpired.execute(SYSTEM)).updated).toBe(0);
    world.clock.set('2026-10-31T05:00:00.000Z');
    expect((await world.markExpired.execute(SYSTEM)).updated).toBe(1);
  });

  it('catches an archived document the first run after it is restored', async () => {
    const world = seededWorld();
    world.seedDocument({
      id: 'doc_old',
      typeId: 'dtyp_nda',
      expiresAt: '2026-01-01',
      deletedAt: new Date('2026-10-01'),
    });
    expect((await world.markExpired.execute(SYSTEM)).updated).toBe(0);

    await world.restoreDocument.execute(admin, { id: 'doc_old' });
    const result = await world.markExpired.execute(SYSTEM);

    expect(result.documentIds).toEqual(['doc_old']);
  });

  it('rechecks the committed row: a document archived after the candidate read is left alone', async () => {
    const world = seededWorld();
    const { archived } = seed(world);
    vi.spyOn(world.documents, 'expiredIds').mockResolvedValue([archived.id]);

    const result = await world.markExpired.execute(SYSTEM);

    expect(result.updated).toBe(0);
    expect(world.documents.rows.find((row) => row.id === archived.id)?.status).toBe('BORRADOR');
  });

  it('sends a CONFLICT to skippedIds (DT-129) and still processes the rest; any other error aborts', async () => {
    const world = seededWorld();
    seed(world);
    const lock = world.support.lock.bind(world.support);
    vi.spyOn(world.support, 'lock').mockImplementation(async (ids) => {
      if (ids.includes('doc_sent')) throw new ConflictError();
      await lock(ids);
    });

    const result = await world.markExpired.execute(SYSTEM);
    expect(result.documentIds).toEqual(['doc_draft', 'doc_signed']);
    expect(result.skippedIds).toEqual(['doc_sent']);

    vi.spyOn(world.support, 'lock').mockRejectedValue(new Error('boom'));
    await expect(world.markExpired.execute(SYSTEM)).rejects.toThrow('boom');
  });

  it("is the system's alone: a user actor is FORBIDDEN (DT-130)", async () => {
    const world = seededWorld();
    seed(world);
    await expect(world.markExpired.execute(actorOf(owner))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      world.markExpired.execute({ actorType: 'PUBLIC', userId: null }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(world.documents.writeCount).toBe(0);
  });
});
