import { describe, expect, it } from 'vitest';
import {
  actor,
  KAIROS,
  NEXT_JS,
  projectRecord,
  projectWorld,
  query,
  RUST,
  TORNILLO,
} from '../../../../../test/commercial/projects/fakes/world';
import { ValidationFailedError } from '../../../../shared/domain/domain-error';

const linked = (clientId: string) => ({ clientId, role: null, linkedAt: new Date('2026-01-01Z') });

function seeded() {
  const world = projectWorld();
  world.projects.seed(
    projectRecord({
      id: 'p1',
      code: 'PRY-0001',
      name: 'Sitio Kairós',
      status: 'EN_CURSO',
      targetEndDate: '2026-06-01',
      technologyIds: [NEXT_JS.id],
      createdAt: new Date('2026-01-01Z'),
    }),
    projectRecord({
      id: 'p2',
      code: 'PRY-0002',
      name: 'Tienda Tornillo',
      status: 'PROPUESTA',
      targetEndDate: '2026-09-01',
      technologyIds: [RUST.id],
      clients: [linked(TORNILLO)],
      createdAt: new Date('2026-02-01Z'),
    }),
    projectRecord({
      id: 'p3',
      code: 'PRY-0003',
      name: 'Archivado',
      status: 'ENTREGADO',
      archivedAt: new Date('2026-03-01Z'),
      createdAt: new Date('2026-03-01Z'),
    }),
  );
  world.projects.setMetrics('p1', {
    contractedValueUsd: '500.00',
    invoicedUsd: '100.00',
    collectedUsd: '50.00',
    toInvoiceUsd: '400.00',
  });
  return world;
}

describe('ListProjects (mock listProjects)', () => {
  it('defaults to code:desc and hides archived projects', async () => {
    const world = seeded();
    const page = await world.listProjects.execute(actor('OWNER'), query());
    expect(page.items.map((r) => r.code)).toEqual(['PRY-0002', 'PRY-0001']);
    expect(page).toMatchObject({ total: 2, page: 1, pageCount: 1 });
  });

  it('honours archived=only|include for the trash roles and ignores it for the rest (contract choice 2)', async () => {
    const world = seeded();
    const only = await world.listProjects.execute(actor('ADMIN'), query({ archived: 'only' }));
    expect(only.items.map((r) => r.code)).toEqual(['PRY-0003']);
    const include = await world.listProjects.execute(
      actor('OWNER'),
      query({ archived: 'include' }),
    );
    expect(include.total).toBe(3);

    for (const role of ['MEMBER', 'VIEWER'] as const) {
      const page = await world.listProjects.execute(actor(role), query({ archived: 'include' }));
      expect(page.items.map((r) => r.code)).toEqual(['PRY-0002', 'PRY-0001']);
    }
  });

  it('filters by technology (HU-06 CA2), status, client and delivery window', async () => {
    const world = seeded();
    const codes = async (filters: Record<string, string | string[]>) =>
      (await world.listProjects.execute(actor('OWNER'), query({ filters }))).items.map(
        (r) => r.code,
      );

    expect(await codes({ technologyId: NEXT_JS.id })).toEqual(['PRY-0001']);
    expect(await codes({ technologyId: [NEXT_JS.id, RUST.id] })).toEqual(['PRY-0002', 'PRY-0001']);
    expect(await codes({ status: 'PROPUESTA' })).toEqual(['PRY-0002']);
    expect(await codes({ clientId: KAIROS })).toEqual(['PRY-0001']);
    expect(await codes({ deliveryFrom: '2026-07-01' })).toEqual(['PRY-0002']);
    expect(await codes({ deliveryTo: '2026-07-01' })).toEqual(['PRY-0001']);
  });

  it('withoutBillingPlan=true keeps only the projects with no billing plan (HU-07, Q-BE3-6)', async () => {
    const world = seeded();
    world.projects.seedPlan('p1');
    const codes = async (filters: Record<string, string | string[]>) =>
      (await world.listProjects.execute(actor('OWNER'), query({ filters }))).items.map(
        (r) => r.code,
      );

    expect(await codes({ withoutBillingPlan: 'true' })).toEqual(['PRY-0002']);
    expect(await codes({ withoutBillingPlan: 'true', status: 'EN_CURSO' })).toEqual([]);
    expect(await codes({})).toEqual(['PRY-0002', 'PRY-0001']);
  });

  it('searches by code, name and client name, sorts and paginates', async () => {
    const world = seeded();
    const search = async (q: string) =>
      (await world.listProjects.execute(actor('OWNER'), query({ q }))).items.map((r) => r.code);
    expect(await search('tienda')).toEqual(['PRY-0002']);
    expect(await search('PRY-0001')).toEqual(['PRY-0001']);
    expect(await search('kairos')).toEqual(['PRY-0001']);

    const asc = await world.listProjects.execute(
      actor('OWNER'),
      query({ sort: { field: 'name', direction: 'asc' }, pageSize: 25 }),
    );
    expect(asc.items.map((r) => r.name)).toEqual(['Sitio Kairós', 'Tienda Tornillo']);
    const paged = await world.listProjects.execute(
      actor('OWNER'),
      query({ pageSize: 25, page: 2 }),
    );
    expect(paged.items).toEqual([]);
  });

  it('sorts status in enum order', async () => {
    const world = seeded();
    const page = await world.listProjects.execute(
      actor('OWNER'),
      query({ sort: { field: 'status', direction: 'asc' } }),
    );
    expect(page.items.map((r) => r.status)).toEqual(['PROPUESTA', 'EN_CURSO']);
  });

  it('reads the money columns from ProjectMetrics, "0.00" when the row is absent (Q-BE2-1)', async () => {
    const world = seeded();
    const page = await world.listProjects.execute(
      actor('OWNER'),
      query({ sort: { field: 'contractedValueUsd', direction: 'desc' } }),
    );
    expect(page.items.map((r) => [r.code, r.contractedValueUsd, r.toInvoiceUsd])).toEqual([
      ['PRY-0001', '500.00', '400.00'],
      ['PRY-0002', '0.00', '0.00'],
    ]);
  });

  it('nulls the money fields and refuses money sorts without canSeeFinancials (C13, contract choice 3)', async () => {
    const world = seeded();
    const page = await world.listProjects.execute(actor('MEMBER'), query());
    for (const row of page.items) {
      expect(row).toMatchObject({
        contractedValueUsd: null,
        invoicedUsd: null,
        collectedUsd: null,
        toInvoiceUsd: null,
      });
    }
    for (const field of ['contractedValueUsd', 'invoicedUsd', 'collectedUsd', 'toInvoiceUsd']) {
      const run = world.listProjects.execute(
        actor('VIEWER'),
        query({ sort: { field, direction: 'asc' } }),
      );
      await expect(run).rejects.toBeInstanceOf(ValidationFailedError);
      await expect(run).rejects.toMatchObject({
        fieldErrors: { sort: ['validation.sort.invalid'] },
      });
    }
  });

  it('shows clients with their role and the stack chips', async () => {
    const world = seeded();
    const [row] = (
      await world.listProjects.execute(actor('OWNER'), query({ filters: { clientId: KAIROS } }))
    ).items;
    expect(row?.clients).toEqual([
      {
        client: { type: 'CLIENT', id: KAIROS, code: `CLI-${KAIROS}`, label: 'Kairós' },
        role: 'Contratante',
      },
    ]);
    expect(row?.stack).toEqual([expect.objectContaining({ id: NEXT_JS.id, name: 'Next.js' })]);
  });
});
