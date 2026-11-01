import { describe, expect, it } from 'vitest';
import {
  admin,
  member,
  newDocument,
  owner,
  seededWorld,
  viewer,
  type World,
} from '../../../../../../test/documents/records/world';
import { ForbiddenError, NotFoundError } from '../../../../../shared/domain/domain-error';
import type { CurrentUser } from '../../../../../shared/application/current-user';

// Behavioral spec: `updateDocumentMeta` of fe/src/mocks/services/documents.ts (documents-lifecycle.test.ts).

async function created(
  world: World,
  actor: CurrentUser = owner,
  over: Record<string, unknown> = {},
) {
  return world.createDocument.execute(
    actor,
    newDocument({
      summary: 'Resumen',
      effectiveDate: '2026-10-01',
      expiresAt: '2027-01-01',
      ...over,
    }),
  );
}

const form = (doc: Awaited<ReturnType<typeof created>>, over: Record<string, unknown> = {}) => ({
  id: doc.id,
  title: doc.title,
  typeId: doc.type.id,
  summary: doc.summary,
  effectiveDate: doc.effectiveDate,
  signedAt: doc.signedAt,
  expiresAt: doc.expiresAt,
  alertDaysBefore: doc.alertDaysBefore,
  tagIds: [] as string[],
  ...over,
});

describe('UpdateDocumentMeta', () => {
  it('updates the metadata, reindexes and logs UPDATE with the changed fields only', async () => {
    const world = seededWorld();
    const doc = await created(world);
    world.clock.advance(60_000);

    const updated = await world.updateMeta.execute(
      member,
      form(doc, { title: 'NDA revisado', alertDaysBefore: 10, summary: 'Nuevo resumen' }),
    );

    expect(updated).toMatchObject({
      title: 'NDA revisado',
      alertDaysBefore: 10,
      summary: 'Nuevo resumen',
      updatedAt: world.clock.now(),
    });
    const entry = world.activity.entries.at(-1);
    expect(entry).toMatchObject({
      action: 'UPDATE',
      entityId: doc.id,
      entityLabel: 'NDA revisado',
      clientId: 'cli_kairos',
      changes: {
        title: ['NDA con Kairos', 'NDA revisado'],
        summary: 'changed',
        alertDaysBefore: ['30', '10'],
      },
    });
    expect(Object.keys(entry?.changes ?? {})).toEqual(['title', 'summary', 'alertDaysBefore']);
    expect(world.search.get('DOCUMENT', doc.id)).toMatchObject({
      title: 'NDA revisado',
      body: 'Nuevo resumen',
    });
    expect(world.locks.acquired).toEqual([{ rowClass: 'Document', id: doc.id }]);
    expect(world.uow.lastOptions).toEqual({ isolation: 'Serializable' });
  });

  it('changes nothing and logs nothing when the form is the same', async () => {
    const world = seededWorld();
    const doc = await created(world);
    const entries = world.activity.entries.length;
    const writes = world.documents.writeCount;
    world.clock.advance(60_000);
    const again = await world.updateMeta.execute(owner, form(doc));
    expect(again.updatedAt).toEqual(doc.updatedAt);
    expect(world.activity.entries).toHaveLength(entries);
    expect(world.documents.writeCount).toBe(writes);
  });

  it('replaces the tags and logs them as a change', async () => {
    const world = seededWorld();
    world.seedTag('tag_a', 'A');
    world.seedTag('tag_b', 'B');
    const doc = await created(world, owner, { tagIds: ['tag_a'] });
    const updated = await world.updateMeta.execute(owner, form(doc, { tagIds: ['tag_b'] }));
    expect(updated.tags.map((t) => t.id)).toEqual(['tag_b']);
    expect(world.activity.entries.at(-1)?.changes).toEqual({
      tagIds: ['["tag_a"]', '["tag_b"]'],
    });
  });

  it('applies the type rules of the new type', async () => {
    const world = seededWorld();
    const doc = await created(world);
    await expect(
      world.updateMeta.execute(owner, form(doc, { typeId: 'dtyp_nota' })),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { expiresAt: ['documents.validation.expiresAtNotAllowed'] },
    });
    await expect(
      world.updateMeta.execute(owner, form(doc, { typeId: 'dtyp_propuesta', expiresAt: null })),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { typeId: ['validation.invalidOption'] },
    });
    await expect(
      world.updateMeta.execute(owner, form(doc, { expiresAt: '2026-09-01' })),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { expiresAt: ['validation.date.invalid'] },
    });
  });

  it('keeps an inactive type the document already has', async () => {
    const world = seededWorld();
    const doc = await created(world, owner, { typeId: 'dtyp_nota', expiresAt: undefined });
    await world.types.seed([
      {
        id: 'dtyp_nota',
        categoryId: 'dcat_tecnico',
        name: 'Nota técnica',
        nameEn: null,
        requiresSignature: false,
        hasExpiration: false,
        defaultFormat: 'MARKDOWN',
        active: false,
      },
    ]);
    const updated = await world.updateMeta.execute(owner, form(doc, { title: 'Sigue' }));
    expect(updated.title).toBe('Sigue');
  });

  it('a FIRMADO document cannot lose its signature date nor move to a type without signature', async () => {
    const world = seededWorld();
    const doc = await created(world);
    for (const status of ['EN_REVISION', 'APROBADO', 'ENVIADO'] as const) {
      await world.setStatus.execute(owner, { id: doc.id, status });
    }
    const signed = await world.setStatus.execute(owner, {
      id: doc.id,
      status: 'FIRMADO',
      signedAt: '2026-10-08',
    });
    await expect(
      world.updateMeta.execute(owner, form(signed, { signedAt: null })),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { signedAt: ['validation.required'] },
    });
    await expect(
      world.updateMeta.execute(
        owner,
        form(signed, { typeId: 'dtyp_manual', signedAt: null, expiresAt: '2027-01-01' }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(world.documents.rows[0]?.typeId).toBe('dtyp_nda');
  });

  it('refuses a Viewer, an unknown document and an archived one', async () => {
    const world = seededWorld();
    const doc = await created(world);
    await expect(world.updateMeta.execute(viewer, form(doc))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      world.updateMeta.execute(owner, form(doc, { id: 'doc_missing' })),
    ).rejects.toBeInstanceOf(NotFoundError);
    await world.archiveDocument.execute(admin, { id: doc.id });
    await expect(world.updateMeta.execute(owner, form(doc))).rejects.toBeInstanceOf(NotFoundError);
  });
});
