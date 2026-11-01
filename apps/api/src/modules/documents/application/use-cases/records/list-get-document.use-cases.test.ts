import { describe, expect, it } from 'vitest';
import {
  ANA,
  INVOICE_1,
  KAIROS,
  KAIROS_ALT,
  KAIROS_WEB,
  SOLARIS,
  admin,
  member,
  newDocument,
  owner,
  query,
  seededWorld,
  viewer,
  type World,
} from '../../../../../../test/documents/records/world';
import { ForbiddenError, NotFoundError } from '../../../../../shared/domain/domain-error';
import type { ListQuery } from '../../../../../shared/domain/list-query';

// Behavioral spec: `listDocuments`, `countDocumentsByCategory` and `getDocument` of
// fe/src/mocks/services/documents.ts (documents.test.ts, documents-lifecycle.test.ts) and DT-141, DT-142.

const filtered = (filters: ListQuery['filters'], over: Partial<ListQuery> = {}) =>
  query({ filters, ...over });

async function seedSet(world: World) {
  world.seedTag('tag_urgente', 'Urgente');
  const nda = await world.createDocument.execute(
    owner,
    newDocument({
      title: 'NDA Kairos',
      links: [KAIROS, KAIROS_WEB, KAIROS_ALT, ANA, INVOICE_1],
      expiresAt: '2026-11-15',
      tagIds: ['tag_urgente'],
    }),
  );
  world.clock.advance(60_000);
  const nota = await world.createDocument.execute(
    owner,
    newDocument({ title: 'Nota técnica Solaris', typeId: 'dtyp_nota', links: [SOLARIS] }),
  );
  world.clock.advance(60_000);
  const manual = await world.createDocument.execute(
    owner,
    newDocument({
      title: 'Manual de operación',
      typeId: 'dtyp_manual',
      links: [KAIROS],
      expiresAt: '2027-06-01',
    }),
  );
  return { nda, nota, manual };
}

const idsOf = async (world: World, over: Partial<ListQuery>, actor = owner) =>
  (await world.listDocuments.execute(actor, query(over))).items.map((row) => row.title);

describe('ListDocuments', () => {
  it('lists the rows with category, type, current version, links and tags, newest update first', async () => {
    const world = seededWorld();
    await seedSet(world);
    const page = await world.listDocuments.execute(owner, query());

    expect(page).toMatchObject({ total: 3, page: 1, pageSize: 25, pageCount: 1 });
    expect(page.items.map((r) => r.title)).toEqual([
      'Manual de operación',
      'Nota técnica Solaris',
      'NDA Kairos',
    ]);
    expect(page.items[2]).toMatchObject({
      code: 'DOC-0001',
      status: 'BORRADOR',
      category: { id: 'dcat_legal', name: 'Legal' },
      type: { id: 'dtyp_nda', name: 'NDA' },
      currentFormat: null,
      currentVersionNumber: null,
      expiresAt: '2026-11-15',
      isShared: false,
      archivedAt: null,
      tags: [{ id: 'tag_urgente', name: 'Urgente', color: '#112233' }],
    });
    expect(page.items[2]?.links.map((l) => `${l.type}:${l.id}`)).toEqual([
      'CLIENT:cli_kairos',
      'PROJECT:pry_kairos_web',
      'PROJECT:pry_kairos_app',
      'CONTACT:con_ana',
      'INVOICE:inv_1',
    ]);
  });

  it('shows the current version of a document with a file', async () => {
    const world = seededWorld();
    world.seedFile('fil_a', owner);
    await world.createDocument.execute(
      owner,
      newDocument({ initialVersion: { format: 'ARCHIVO', fileId: 'fil_a' } }),
    );
    const [row] = (await world.listDocuments.execute(owner, query())).items;
    expect(row).toMatchObject({ currentFormat: 'ARCHIVO', currentVersionNumber: 1 });
  });

  it('filters by status, type, category, format, tag, link and expiry facets, which combine', async () => {
    const world = seededWorld();
    const { nda } = await seedSet(world);
    world.seedFile('fil_a', owner);
    await world.setStatus.execute(owner, { id: nda.id, status: 'EN_REVISION' });

    expect(await idsOf(world, { filters: { status: 'EN_REVISION' } })).toEqual(['NDA Kairos']);
    expect(await idsOf(world, { filters: { status: ['EN_REVISION', 'BORRADOR'] } })).toHaveLength(
      3,
    );
    expect(await idsOf(world, { filters: { typeId: 'dtyp_nota' } })).toEqual([
      'Nota técnica Solaris',
    ]);
    expect(await idsOf(world, { filters: { categoryId: 'dcat_operativo' } })).toEqual([
      'Manual de operación',
    ]);
    expect(await idsOf(world, { filters: { tagId: 'tag_urgente' } })).toEqual(['NDA Kairos']);
    // The NDA changed status last, so it is the most recently updated.
    expect(await idsOf(world, { filters: { clientId: 'cli_kairos' } })).toEqual([
      'NDA Kairos',
      'Manual de operación',
    ]);
    expect(await idsOf(world, { filters: { projectId: 'pry_kairos_app' } })).toEqual([
      'NDA Kairos',
    ]);
    expect(
      await idsOf(world, { filters: { clientId: 'cli_kairos', projectId: 'pry_kairos_web' } }),
    ).toEqual(['NDA Kairos']);
    expect(await idsOf(world, { filters: { contactId: 'con_ana' } })).toEqual(['NDA Kairos']);
    expect(await idsOf(world, { filters: { invoiceId: 'inv_1' } })).toEqual(['NDA Kairos']);
    expect(await idsOf(world, { filters: { expiresFrom: '2027-01-01' } })).toEqual([
      'Manual de operación',
    ]);
    expect(await idsOf(world, { filters: { expiresTo: '2026-12-31' } })).toEqual(['NDA Kairos']);
    expect(await idsOf(world, { filters: { format: 'ARCHIVO' } })).toEqual([]);
  });

  it('searches code and title with q, accent- and case-insensitively', async () => {
    const world = seededWorld();
    await seedSet(world);
    expect(await idsOf(world, { q: 'TECNICA' })).toEqual(['Nota técnica Solaris']);
    expect(await idsOf(world, { q: 'doc-0001' })).toEqual(['NDA Kairos']);
  });

  it('applies the overview shortcuts: expiring within N days, stale drafts and shared', async () => {
    const world = seededWorld();
    const { nda, nota } = await seedSet(world);
    // today is 2026-10-30 (Caracas): the NDA expires on 2026-11-15 (16 days), the manual in 2027.
    expect(await idsOf(world, { filters: { expiringWithinDays: '30' } })).toEqual(['NDA Kairos']);
    expect(await idsOf(world, { filters: { expiringWithinDays: '10' } })).toEqual([]);

    world.clock.advance(15 * 86_400_000);
    expect(await idsOf(world, { filters: { staleDraft: 'true' } })).toEqual([
      'Manual de operación',
      'Nota técnica Solaris',
      'NDA Kairos',
    ]);
    await world.setStatus.execute(owner, { id: nda.id, status: 'EN_REVISION' });
    expect(await idsOf(world, { filters: { staleDraft: 'true' } })).toHaveLength(2);

    world.shares.set(nota.id, [{ revokedAt: null, expiresAt: null }]);
    world.shares.set(nda.id, [{ revokedAt: new Date(), expiresAt: null }]);
    expect(await idsOf(world, { filters: { shared: 'true' } })).toEqual(['Nota técnica Solaris']);
    expect(await idsOf(world, { filters: { shared: 'false' } })).toHaveLength(2);
    const [shared] = (await world.listDocuments.execute(owner, filtered({ shared: 'true' }))).items;
    expect(shared?.isShared).toBe(true);
  });

  it('does not count an expired or revoked share link as shared', async () => {
    const world = seededWorld();
    const { nota } = await seedSet(world);
    world.shares.set(nota.id, [{ revokedAt: null, expiresAt: '2026-10-29' }]);
    expect(await idsOf(world, { filters: { shared: 'true' } })).toEqual([]);
    world.shares.set(nota.id, [{ revokedAt: null, expiresAt: '2026-10-30' }]);
    expect(await idsOf(world, { filters: { shared: 'true' } })).toEqual(['Nota técnica Solaris']);
  });

  it('validates the facet values (VALIDATION on the facet)', async () => {
    const world = seededWorld();
    for (const [filters, field] of [
      [{ status: 'NOPE' }, 'status'],
      [{ format: 'PDF' }, 'format'],
      [{ expiresFrom: '2026-13-40' }, 'expiresFrom'],
      [{ shared: 'maybe' }, 'shared'],
      [{ staleDraft: '1' }, 'staleDraft'],
      [{ expiringWithinDays: '0' }, 'expiringWithinDays'],
      [{ expiringWithinDays: 'x' }, 'expiringWithinDays'],
    ] as const) {
      await expect(world.listDocuments.execute(owner, filtered(filters))).rejects.toMatchObject({
        code: 'VALIDATION',
        fieldErrors: { [field]: expect.any(Array) },
      });
    }
  });

  it('pages and sorts over the whole set', async () => {
    const world = seededWorld();
    await seedSet(world);
    const page = await world.listDocuments.execute(
      owner,
      query({ pageSize: 25, sort: { field: 'title', direction: 'asc' }, page: 1 }),
    );
    expect(page.items.map((r) => r.title)).toEqual([
      'Manual de operación',
      'NDA Kairos',
      'Nota técnica Solaris',
    ]);
    const sorted = await world.listDocuments.execute(
      owner,
      query({ sort: { field: 'expiresAt', direction: 'asc' } }),
    );
    expect(sorted.items.map((r) => r.expiresAt)).toEqual(['2026-11-15', '2027-06-01', null]);
  });

  it('hides archived documents unless a trash role asks (C19)', async () => {
    const world = seededWorld();
    const { nda } = await seedSet(world);
    await world.archiveDocument.execute(admin, { id: nda.id });
    expect(await idsOf(world, {})).not.toContain('NDA Kairos');
    expect(await idsOf(world, { archived: 'only' })).toEqual(['NDA Kairos']);
    expect(await idsOf(world, { archived: 'include' })).toHaveLength(3);
    // Without the trash grant `archived` is ignored: the live documents, never the archived one.
    expect(await idsOf(world, { archived: 'only' }, member)).toEqual([
      'Manual de operación',
      'Nota técnica Solaris',
    ]);
    expect(await idsOf(world, { archived: 'include' }, member)).toHaveLength(2);
    const [row] = (await world.listDocuments.execute(admin, query({ archived: 'only' }))).items;
    expect(row?.archivedAt).toEqual(world.clock.now());
  });

  describe("chips and facets follow the caller's read grants (DT-142)", () => {
    it('leaves out the financial chips for a Member and keeps them for an Admin', async () => {
      const world = seededWorld();
      await seedSet(world);
      const rowFor = async (actor: typeof owner) =>
        (await world.listDocuments.execute(actor, filtered({ typeId: 'dtyp_nda' }))).items[0];
      expect((await rowFor(member))?.links.map((l) => l.type)).toEqual([
        'CLIENT',
        'PROJECT',
        'PROJECT',
        'CONTACT',
      ]);
      expect((await rowFor(admin))?.links.map((l) => l.type)).toContain('INVOICE');
      expect((await rowFor(viewer))?.links.map((l) => l.type)).not.toContain('INVOICE');
    });

    it('answers NOT_FOUND when filtering by a type the caller cannot read', async () => {
      const world = seededWorld();
      await seedSet(world);
      for (const facet of ['invoiceId', 'paymentId', 'expenseId']) {
        await expect(
          world.listDocuments.execute(member, filtered({ [facet]: 'x' })),
        ).rejects.toBeInstanceOf(NotFoundError);
      }
      await expect(
        world.listDocuments.execute(member, filtered({ clientId: 'cli_kairos' })),
      ).resolves.toMatchObject({ total: 2 });
    });
  });

  it('refuses a caller without read on documents', async () => {
    const world = seededWorld();
    const stranger = { ...viewer, role: 'NONE' as never };
    await expect(world.listDocuments.execute(stranger, query())).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe('CountDocumentsByCategory', () => {
  it('counts live documents per category under every facet but the category, and q applies', async () => {
    const world = seededWorld();
    const { manual } = await seedSet(world);
    expect(await world.countByCategory.execute(owner, query())).toEqual({
      dcat_legal: 1,
      dcat_tecnico: 1,
      dcat_operativo: 1,
    });
    expect(
      await world.countByCategory.execute(
        owner,
        filtered({ categoryId: 'dcat_legal', clientId: 'cli_kairos' }),
      ),
    ).toEqual({ dcat_legal: 1, dcat_operativo: 1 });
    expect(await world.countByCategory.execute(owner, query({ q: 'manual' }))).toEqual({
      dcat_operativo: 1,
    });
    await world.archiveDocument.execute(admin, { id: manual.id });
    expect(await world.countByCategory.execute(owner, query())).toEqual({
      dcat_legal: 1,
      dcat_tecnico: 1,
    });
  });

  it('refuses a Viewer-less role and the NOT_FOUND facets as the list does', async () => {
    const world = seededWorld();
    await expect(
      world.countByCategory.execute(member, filtered({ invoiceId: 'inv_1' })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('GetDocument', () => {
  it('reads the detail; an archived document only for roles that open the trash', async () => {
    const world = seededWorld();
    const { nda } = await seedSet(world);
    const detail = await world.getDocument.execute(viewer, { id: nda.id });
    expect(detail).toMatchObject({ id: nda.id, code: 'DOC-0001', title: 'NDA Kairos' });
    expect(detail.links.map((l) => l.entity.type)).not.toContain('INVOICE');

    await world.archiveDocument.execute(admin, { id: nda.id });
    expect((await world.getDocument.execute(admin, { id: nda.id })).archivedAt).not.toBeNull();
    for (const actor of [member, viewer]) {
      await expect(world.getDocument.execute(actor, { id: nda.id })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    }
    await expect(world.getDocument.execute(admin, { id: 'doc_missing' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
