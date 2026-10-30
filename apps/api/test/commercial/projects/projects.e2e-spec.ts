import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../../../src/app.setup';
import { TechnologyUsageQueries } from '../../../src/modules/commercial/application/technology-usage.queries';
import { ProjectsModule } from '../../../src/modules/commercial/projects.module';
import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { AUTHORIZATION } from '../../../src/shared/application/ports/tokens';
import type { UserRole } from '../../../src/shared/domain/enums';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';
import { createTestApp } from '../../support/test-app';

const BASE = '/api/v1/projects';
const admin = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));
const E2E = 'e2e-';

/** One real Postgres per file (DT-117): users, clients and technologies are created once and shared. */
describe('projects (e2e)', { timeout: 120_000 }, () => {
  let app: NestExpressApplication;
  const tokens: Partial<Record<UserRole, string>> = {};
  let kairos = '';
  let tornillo = '';
  let archivedClient = '';
  let nextJs = '';
  let rust = '';
  let react = '';
  let firstProjectId = '';

  beforeAll(async () => {
    await truncateBusinessTables(admin);
    await admin.technology.deleteMany({ where: { slug: { startsWith: E2E } } });
    const authenticator = new FakeAuthenticator();
    app = await createTestApp({
      modules: [ProjectsModule],
      authenticator,
      overrides: [{ token: AUTHORIZATION, useValue: new MatrixAuthorization() }],
    });
    for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const) {
      const row = await admin.user.create({
        data: {
          clerkId: `user_prj_${role.toLowerCase()}`,
          email: `prj-${role.toLowerCase()}@example.test`,
          name: role,
          role,
        },
      });
      const user: CurrentUser = {
        userId: row.id,
        clerkId: row.clerkId,
        role,
        email: row.email,
        name: row.name,
      };
      tokens[role] = authenticator.issue(user);
    }
    const client = (code: string, tradeName: string, deletedAt: Date | null = null) =>
      admin.client.create({
        data: {
          code,
          kind: 'EMPRESA',
          tradeName,
          legalName: `${tradeName} C.A.`,
          taxId: `J-${code}`,
          country: 'VE',
          address: 'Test address',
          phone: '+58 000 0000',
          deletedAt,
        },
      });
    kairos = (await client('CLI-0001', 'Kairós')).id;
    tornillo = (await client('CLI-0002', 'Tornillo')).id;
    archivedClient = (await client('CLI-0003', 'Viejo', new Date())).id;
    const tech = (slug: string, active = true) =>
      admin.technology.create({
        data: { name: `E2E ${slug}`, slug: `${E2E}${slug}`, category: 'BACKEND', active },
      });
    nextJs = (await tech('next')).id;
    rust = (await tech('rust')).id;
    react = (await tech('react', false)).id;
  });

  afterAll(async () => {
    await app.close();
    await truncateBusinessTables(admin);
    await admin.technology.deleteMany({ where: { slug: { startsWith: E2E } } });
    await admin.$disconnect();
  });

  const as = (role: UserRole) => `Bearer ${tokens[role]}`;
  const http = () => request(app.getHttpServer());

  const body = (over: Record<string, unknown> = {}) => ({
    name: 'Sitio de prueba',
    summary: 'Un proyecto de prueba',
    clients: [{ clientId: kairos, role: 'Contratante' }],
    ...over,
  });

  async function createProject(over: Record<string, unknown> = {}, role: UserRole = 'ADMIN') {
    const res = await http().post(BASE).set('Authorization', as(role)).send(body(over)).expect(201);
    return res.body as { id: string; code: string };
  }

  const projectCount = async (clientId: string) =>
    (await admin.clientMetrics.findUnique({ where: { clientId } }))?.projectCount;

  it('refuses an unauthenticated request with UNAUTHENTICATED', async () => {
    const res = await http().get(BASE).expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('HU-05 CA1: a project needs at least one live client', async () => {
    const none = await http()
      .post(BASE)
      .set('Authorization', as('ADMIN'))
      .send(body({ clients: [] }))
      .expect(422);
    expect(none.body.error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { clients: ['validation.required'] },
    });

    for (const clientId of ['cli_ghost', archivedClient]) {
      const res = await http()
        .post(BASE)
        .set('Authorization', as('ADMIN'))
        .send(body({ clients: [{ clientId }] }))
        .expect(422);
      expect(res.body.error.fieldErrors).toEqual({ clients: ['projects.errors.clientNotFound'] });
    }
    expect(await admin.project.count()).toBe(0);
  });

  it('HU-05 CA2, CA3: creates PRY-0001 with two clients and a role per link, and indexes it', async () => {
    const res = await http()
      .post(BASE)
      .set('Authorization', as('ADMIN'))
      .send(
        body({
          clients: [
            { clientId: tornillo, role: 'Contratante' },
            { clientId: kairos, role: 'Usuario final' },
          ],
          description: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Detalle' }] }],
          },
        }),
      )
      .expect(201);
    firstProjectId = res.body.id;
    expect(res.body).toMatchObject({
      code: 'PRY-0001',
      status: 'PROPUESTA',
      summary: 'Un proyecto de prueba',
      endDate: null,
      hasBillingPlan: false,
      contractedValueUsd: '0.00',
      toInvoiceUsd: '0.00',
      archivedAt: null,
    });
    expect(
      res.body.clients.map((c: { client: { id: string }; role: string }) => [c.client.id, c.role]),
    ).toEqual([
      [tornillo, 'Contratante'],
      [kairos, 'Usuario final'],
    ]);

    // Listed under each linked client's filter.
    for (const clientId of [kairos, tornillo]) {
      const list = await http()
        .get(`${BASE}?clientId=${clientId}`)
        .set('Authorization', as('ADMIN'))
        .expect(200);
      expect(list.body.items.map((r: { id: string }) => r.id)).toContain(firstProjectId);
    }

    // CREATE entry scoped to the earliest client, SearchEntry and ClientMetrics (Q-BE2-2/3).
    const entries = await admin.activityLog.findMany({
      where: { entityType: 'PROJECT', entityId: firstProjectId },
      orderBy: { createdAt: 'asc' },
    });
    expect(entries.map((e) => e.action).sort()).toEqual(['CREATE', 'LINK', 'LINK']);
    expect(entries.find((e) => e.action === 'CREATE')).toMatchObject({
      actorType: 'USER',
      clientId: tornillo,
      entityLabel: 'Sitio de prueba',
    });
    const search = await admin.searchEntry.findUnique({
      where: { entityType_entityId: { entityType: 'PROJECT', entityId: firstProjectId } },
    });
    expect(search).toMatchObject({
      code: 'PRY-0001',
      title: 'Sitio de prueba',
      status: 'PROPUESTA',
      archived: false,
    });
    expect(search?.subtitle).toBe('Tornillo, Kairós');
    expect(search?.body).toBe('Un proyecto de prueba\nDetalle');
    expect(await projectCount(kairos)).toBe(1);
    expect(await projectCount(tornillo)).toBe(1);
    expect(
      (await admin.clientMetrics.findUnique({ where: { clientId: kairos } }))?.lastActivityAt,
    ).not.toBeNull();
  });

  it('HU-05: keeps the summary to 280 characters and rejects images in the description', async () => {
    const long = await http()
      .post(BASE)
      .set('Authorization', as('ADMIN'))
      .send(body({ summary: 'x'.repeat(281) }))
      .expect(422);
    expect(long.body.error.fieldErrors).toEqual({ summary: ['validation.tooLong'] });

    const image = await http()
      .post(BASE)
      .set('Authorization', as('ADMIN'))
      .send(
        body({
          description: { type: 'doc', content: [{ type: 'image', attrs: { fileId: 'fil_1' } }] },
        }),
      )
      .expect(422);
    expect(image.body.error.fieldErrors).toEqual({ description: ['validation.invalidFormat'] });

    const script = await http()
      .post(BASE)
      .set('Authorization', as('ADMIN'))
      .send(body({ description: { type: 'doc', content: [{ type: 'script' }] } }))
      .expect(422);
    expect(script.body.error.fieldErrors.description).toBeDefined();
  });

  it('HU-06 CA1: an inactive or unknown technology is 422; active ones are the stack', async () => {
    const inactive = await http()
      .post(BASE)
      .set('Authorization', as('ADMIN'))
      .send(body({ technologyIds: [react] }))
      .expect(422);
    expect(inactive.body.error.fieldErrors).toEqual({
      technologyIds: ['projects.errors.technologyInactive'],
    });
    const unknown = await http()
      .post(BASE)
      .set('Authorization', as('ADMIN'))
      .send(body({ technologyIds: ['tec_ghost'] }))
      .expect(422);
    expect(unknown.body.error.fieldErrors).toEqual({
      technologyIds: ['projects.errors.technologyUnknown'],
    });

    const ok = await createProject({ technologyIds: [nextJs, rust] });
    const detail = await http()
      .get(`${BASE}/${ok.id}`)
      .set('Authorization', as('VIEWER'))
      .expect(200);
    expect(detail.body.stack.map((t: { name: string }) => t.name)).toEqual([
      'E2E next',
      'E2E rust',
    ]);
  });

  it('HU-06 CA2: filters by technology and the usage count reaches the technology queries (CA3)', async () => {
    const withRust = await createProject({ technologyIds: [rust] });
    const list = await http()
      .get(`${BASE}?technologyId=${rust}`)
      .set('Authorization', as('MEMBER'))
      .expect(200);
    expect(list.body.items.map((r: { id: string }) => r.id)).toContain(withRust.id);
    expect(
      list.body.items.every((r: { stack: { name: string }[] }) =>
        r.stack.some((t) => t.name === 'E2E rust'),
      ),
    ).toBe(true);

    const queries = app.get(TechnologyUsageQueries);
    expect(await queries.countLiveProjects(rust)).toBeGreaterThanOrEqual(2);
    expect(await queries.countLiveProjects(react)).toBe(0);
  });

  it('HU-07: several links per group, reorder persists, a bad URL is 422 on links.<i>.url', async () => {
    const { id } = await createProject();
    const put = await http()
      .put(`${BASE}/${id}/links`)
      .set('Authorization', as('MEMBER'))
      .send({
        links: [
          { group: 'REPOSITORIO', label: 'Frontend', url: 'https://git.test/fe' },
          { group: 'REPOSITORIO', label: 'Backend', url: 'https://git.test/be' },
          { group: 'ENTORNO', label: 'Prod', url: 'https://prod.test' },
        ],
      })
      .expect(200);
    const links = put.body.links as { id: string; group: string; label: string; order: number }[];
    expect(links.map((l) => [l.group, l.label, l.order])).toEqual([
      ['REPOSITORIO', 'Frontend', 0],
      ['REPOSITORIO', 'Backend', 1],
      ['ENTORNO', 'Prod', 0],
    ]);

    const [fe, be] = links.filter((l) => l.group === 'REPOSITORIO');
    const reordered = await http()
      .post(`${BASE}/${id}/links/reorder`)
      .set('Authorization', as('MEMBER'))
      .send({ group: 'REPOSITORIO', orderedLinkIds: [be?.id, fe?.id] })
      .expect(200);
    expect(reordered.body.links.map((l: { label: string }) => l.label)).toEqual([
      'Backend',
      'Frontend',
      'Prod',
    ]);
    const stored = await http().get(`${BASE}/${id}`).set('Authorization', as('VIEWER')).expect(200);
    expect(stored.body.links.map((l: { label: string }) => l.label)).toEqual([
      'Backend',
      'Frontend',
      'Prod',
    ]);

    const bad = await http()
      .put(`${BASE}/${id}/links`)
      .set('Authorization', as('MEMBER'))
      .send({
        links: [
          { group: 'OTRO', label: 'ok', url: 'https://ok.test' },
          { group: 'OTRO', label: 'bad', url: 'javascript:alert(1)' },
        ],
      })
      .expect(422);
    expect(bad.body.error.fieldErrors).toEqual({ 'links.1.url': ['validation.invalidFormat'] });

    const wrongSet = await http()
      .post(`${BASE}/${id}/links/reorder`)
      .set('Authorization', as('MEMBER'))
      .send({ group: 'REPOSITORIO', orderedLinkIds: [be?.id] })
      .expect(422);
    expect(wrongSet.body.error.fieldErrors).toEqual({
      orderedLinkIds: ['validation.invalidOption'],
    });

    const removed = await http()
      .delete(`${BASE}/${id}/links/${be?.id}`)
      .set('Authorization', as('MEMBER'))
      .expect(200);
    expect(removed.body.links.map((l: { label: string }) => l.label)).toEqual(['Frontend', 'Prod']);
    await http()
      .delete(`${BASE}/${id}/links/${be?.id}`)
      .set('Authorization', as('MEMBER'))
      .expect(404);
  });

  it('HU-08 CA1, CA2: EN_CURSO needs a start date and ENTREGADO an end date', async () => {
    const { id } = await createProject();
    const noStart = await http()
      .post(`${BASE}/${id}/status`)
      .set('Authorization', as('MEMBER'))
      .send({ status: 'EN_CURSO' })
      .expect(422);
    expect(noStart.body.error.fieldErrors).toEqual({ startDate: ['validation.required'] });

    const started = await http()
      .post(`${BASE}/${id}/status`)
      .set('Authorization', as('MEMBER'))
      .send({ status: 'EN_CURSO', startDate: '2026-02-01' })
      .expect(200);
    expect(started.body.project).toMatchObject({ status: 'EN_CURSO', startDate: '2026-02-01' });
    expect(started.body.hints).toEqual(['NO_BILLING_PLAN']);

    const noEnd = await http()
      .post(`${BASE}/${id}/status`)
      .set('Authorization', as('MEMBER'))
      .send({ status: 'ENTREGADO' })
      .expect(422);
    expect(noEnd.body.error.fieldErrors).toEqual({ endDate: ['validation.required'] });

    const backwards = await http()
      .post(`${BASE}/${id}/status`)
      .set('Authorization', as('MEMBER'))
      .send({ status: 'ENTREGADO', endDate: '2026-01-01' })
      .expect(422);
    expect(backwards.body.error.fieldErrors).toEqual({ endDate: ['validation.date.invalid'] });

    const done = await http()
      .post(`${BASE}/${id}/status`)
      .set('Authorization', as('MEMBER'))
      .send({ status: 'ENTREGADO', endDate: '2026-03-01' })
      .expect(200);
    expect(done.body.project).toMatchObject({ status: 'ENTREGADO', endDate: '2026-03-01' });

    const invalid = await http()
      .post(`${BASE}/${id}/status`)
      .set('Authorization', as('MEMBER'))
      .send({ status: 'PAUSADO' })
      .expect(422);
    expect(invalid.body.error.fieldErrors).toEqual({
      status: ['projects.errors.invalidTransition'],
    });
  });

  it('HU-08 CA4: the STATUS_CHANGE entry carries the diff; CANCELADO needs confirm and records its options', async () => {
    const { id } = await createProject();
    await http()
      .post(`${BASE}/${id}/status`)
      .set('Authorization', as('ADMIN'))
      .send({ status: 'EN_CURSO', startDate: '2026-02-01' })
      .expect(200);
    const change = await admin.activityLog.findFirst({
      where: { entityType: 'PROJECT', entityId: id, action: 'STATUS_CHANGE' },
    });
    expect(change?.changes).toEqual({
      status: ['PROPUESTA', 'EN_CURSO'],
      startDate: [null, '2026-02-01'],
    });

    const noConfirm = await http()
      .post(`${BASE}/${id}/status`)
      .set('Authorization', as('ADMIN'))
      .send({ status: 'CANCELADO' })
      .expect(422);
    expect(noConfirm.body.error.fieldErrors).toEqual({ confirm: ['validation.required'] });

    const cancelled = await http()
      .post(`${BASE}/${id}/status`)
      .set('Authorization', as('ADMIN'))
      .send({
        status: 'CANCELADO',
        confirm: true,
        cancelPendingInstallments: true,
        finishRecurringCharges: true,
      })
      .expect(200);
    expect(cancelled.body.project.status).toBe('CANCELADO');
    const entry = await admin.activityLog.findFirst({
      where: { entityType: 'PROJECT', entityId: id, action: 'STATUS_CHANGE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(entry?.changes).toEqual({ status: ['EN_CURSO', 'CANCELADO'] });
    expect(entry?.metadata).toEqual({ cancelledInstallments: 0, finishedRecurringCharges: 0 });
  });

  it('PUT clients keeps projectCount of both clients in step when linking and unlinking', async () => {
    const before = {
      kairos: (await projectCount(kairos)) ?? 0,
      tornillo: (await projectCount(tornillo)) ?? 0,
    };
    const { id } = await createProject({ clients: [{ clientId: kairos }] });
    expect(await projectCount(kairos)).toBe(before.kairos + 1);
    expect(await projectCount(tornillo)).toBe(before.tornillo);

    const linked = await http()
      .put(`${BASE}/${id}/clients`)
      .set('Authorization', as('MEMBER'))
      .send({ clients: [{ clientId: kairos }, { clientId: tornillo, role: 'Usuario final' }] })
      .expect(200);
    expect(linked.body.clients).toHaveLength(2);
    expect(await projectCount(tornillo)).toBe(before.tornillo + 1);

    await http()
      .put(`${BASE}/${id}/clients`)
      .set('Authorization', as('MEMBER'))
      .send({ clients: [{ clientId: tornillo }] })
      .expect(200);
    expect(await projectCount(kairos)).toBe(before.kairos);
    expect(await projectCount(tornillo)).toBe(before.tornillo + 1);
    const actions = (
      await admin.activityLog.findMany({
        where: { entityType: 'PROJECT', entityId: id },
        orderBy: { createdAt: 'asc' },
      })
    ).map((e) => e.action);
    // The second PUT also drops Tornillo's role: an UPDATE (clientRole) before the UNLINK.
    expect(actions).toEqual(['CREATE', 'LINK', 'LINK', 'UPDATE', 'UNLINK']);

    const empty = await http()
      .put(`${BASE}/${id}/clients`)
      .set('Authorization', as('MEMBER'))
      .send({ clients: [] })
      .expect(422);
    expect(empty.body.error.fieldErrors).toEqual({ clients: ['validation.required'] });
  });

  it('PUT technologies replaces the stack with active technologies only', async () => {
    const { id } = await createProject({ technologyIds: [nextJs] });
    const res = await http()
      .put(`${BASE}/${id}/technologies`)
      .set('Authorization', as('MEMBER'))
      .send({ technologyIds: [rust] })
      .expect(200);
    expect(res.body.stack.map((t: { name: string }) => t.name)).toEqual(['E2E rust']);
    await http()
      .put(`${BASE}/${id}/technologies`)
      .set('Authorization', as('MEMBER'))
      .send({ technologyIds: [react] })
      .expect(422);
    const entry = await admin.activityLog.findFirst({
      where: { entityType: 'PROJECT', entityId: id, action: 'UPDATE' },
    });
    expect(entry?.changes).toEqual({ technologyIds: ['E2E next', 'E2E rust'] });
  });

  it('PRD §4.3: Member creates 403 but updates 200; Viewer reads only', async () => {
    const forbidden = await http()
      .post(BASE)
      .set('Authorization', as('MEMBER'))
      .send(body())
      .expect(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
    await http().post(BASE).set('Authorization', as('VIEWER')).send(body()).expect(403);

    const { id } = await createProject();
    const updated = await http()
      .patch(`${BASE}/${id}`)
      .set('Authorization', as('MEMBER'))
      .send(body({ name: 'Renombrado por Member' }))
      .expect(200);
    expect(updated.body.name).toBe('Renombrado por Member');
    const update = await admin.activityLog.findFirst({
      where: { entityType: 'PROJECT', entityId: id, action: 'UPDATE' },
    });
    expect(update?.changes).toEqual({ name: ['Sitio de prueba', 'Renombrado por Member'] });

    await http().patch(`${BASE}/${id}`).set('Authorization', as('VIEWER')).send(body()).expect(403);
    await http()
      .post(`${BASE}/${id}/archive`)
      .set('Authorization', as('MEMBER'))
      .send({})
      .expect(403);
    await http().get(`${BASE}/${id}`).set('Authorization', as('VIEWER')).expect(200);
    await http().get(`${BASE}/pry_ghost`).set('Authorization', as('VIEWER')).expect(404);
  });

  it('C13: money fields are null without canSeeFinancials and money sorts are 422', async () => {
    const { id } = await createProject();
    await admin.projectMetrics.create({
      data: {
        projectId: id,
        contractedUsd: '900.00',
        invoicedUsd: '100.00',
        toInvoiceUsd: '800.00',
      },
    });
    const asAdmin = await http().get(`${BASE}/${id}`).set('Authorization', as('ADMIN')).expect(200);
    expect(asAdmin.body).toMatchObject({
      contractedValueUsd: '900.00',
      invoicedUsd: '100.00',
      collectedUsd: '0.00',
      toInvoiceUsd: '800.00',
    });
    const asMember = await http()
      .get(`${BASE}/${id}`)
      .set('Authorization', as('MEMBER'))
      .expect(200);
    expect(asMember.body).toMatchObject({
      contractedValueUsd: null,
      invoicedUsd: null,
      collectedUsd: null,
      toInvoiceUsd: null,
    });

    const sorted = await http()
      .get(`${BASE}?sort=contractedValueUsd:desc&pageSize=25`)
      .set('Authorization', as('OWNER'))
      .expect(200);
    expect(sorted.body.items[0].id).toBe(id);
    const memberRows = await http()
      .get(`${BASE}?pageSize=100`)
      .set('Authorization', as('MEMBER'))
      .expect(200);
    for (const row of memberRows.body.items) expect(row.contractedValueUsd).toBeNull();

    const denied = await http()
      .get(`${BASE}?sort=toInvoiceUsd:asc`)
      .set('Authorization', as('MEMBER'))
      .expect(422);
    expect(denied.body.error.fieldErrors).toEqual({ sort: ['validation.sort.invalid'] });
    await http().get(`${BASE}?sort=bogus:asc`).set('Authorization', as('OWNER')).expect(422);
  });

  it('lists with search, status filter and the default code:desc order', async () => {
    const a = await createProject({ name: 'Zumbido único' });
    const found = await http()
      .get(`${BASE}?q=zumbido&status=PROPUESTA`)
      .set('Authorization', as('VIEWER'))
      .expect(200);
    expect(found.body.items.map((r: { id: string }) => r.id)).toEqual([a.id]);
    const all = await http()
      .get(`${BASE}?pageSize=100`)
      .set('Authorization', as('VIEWER'))
      .expect(200);
    const codes = all.body.items.map((r: { code: string }) => r.code);
    expect(codes).toEqual([...codes].sort().reverse());
    expect(all.body).toMatchObject({ page: 1, pageSize: 100 });
  });

  it('archives (single and bulk), restores through the route and the trash handler, and honours C19', async () => {
    const one = await createProject({ clients: [{ clientId: kairos }, { clientId: tornillo }] });
    const two = await createProject();
    const baseline = {
      kairos: (await projectCount(kairos)) ?? 0,
      tornillo: (await projectCount(tornillo)) ?? 0,
    };

    const single = await http()
      .post(`${BASE}/${one.id}/archive`)
      .set('Authorization', as('ADMIN'))
      .send({})
      .expect(200);
    expect(single.body).toMatchObject({ id: one.id });
    expect(await projectCount(tornillo)).toBe(baseline.tornillo - 1);
    expect(
      (
        await admin.searchEntry.findUnique({
          where: { entityType_entityId: { entityType: 'PROJECT', entityId: one.id } },
        })
      )?.archived,
    ).toBe(true);
    expect(
      await admin.activityLog.count({
        where: { entityType: 'PROJECT', entityId: one.id, action: 'DELETE' },
      }),
    ).toBe(1);

    // Archived rows: hidden from Member whatever the query says, shown to trash roles.
    await http().get(`${BASE}/${one.id}`).set('Authorization', as('MEMBER')).expect(404);
    await http().get(`${BASE}/${one.id}`).set('Authorization', as('ADMIN')).expect(200);
    const memberList = await http()
      .get(`${BASE}?archived=include&pageSize=100`)
      .set('Authorization', as('MEMBER'))
      .expect(200);
    expect(memberList.body.items.map((r: { id: string }) => r.id)).not.toContain(one.id);
    const adminOnly = await http()
      .get(`${BASE}?archived=only&pageSize=100`)
      .set('Authorization', as('ADMIN'))
      .expect(200);
    expect(adminOnly.body.items.map((r: { id: string }) => r.id)).toEqual([one.id]);
    await http()
      .post(`${BASE}/${one.id}/archive`)
      .set('Authorization', as('ADMIN'))
      .send({})
      .expect(404);
    await http()
      .patch(`${BASE}/${one.id}`)
      .set('Authorization', as('ADMIN'))
      .send(body())
      .expect(404);

    // Restore through the route.
    await http().post(`${BASE}/${one.id}/restore`).set('Authorization', as('MEMBER')).expect(403);
    const restored = await http()
      .post(`${BASE}/${one.id}/restore`)
      .set('Authorization', as('ADMIN'))
      .expect(200);
    expect(restored.body.entity).toMatchObject({ type: 'PROJECT', id: one.id, code: one.code });
    expect(await projectCount(tornillo)).toBe(baseline.tornillo);
    await http().post(`${BASE}/${one.id}/restore`).set('Authorization', as('ADMIN')).expect(404);

    // Bulk is all or nothing.
    const bulkMissing = await http()
      .post(`${BASE}/archive`)
      .set('Authorization', as('ADMIN'))
      .send({ ids: [one.id, two.id, 'pry_ghost'] })
      .expect(404);
    expect(bulkMissing.body.error.code).toBe('NOT_FOUND');
    expect((await admin.project.findUnique({ where: { id: one.id } }))?.deletedAt).toBeNull();
    expect((await admin.project.findUnique({ where: { id: two.id } }))?.deletedAt).toBeNull();

    const bulk = await http()
      .post(`${BASE}/archive`)
      .set('Authorization', as('OWNER'))
      .send({ ids: [one.id, two.id], confirm: true })
      .expect(200);
    expect(bulk.body.archived.map((a: { id: string }) => a.id)).toEqual([one.id, two.id]);
    const stamps = await admin.project.findMany({
      where: { id: { in: [one.id, two.id] } },
      select: { deletedAt: true },
    });
    expect(new Set(stamps.map((s) => s.deletedAt?.toISOString())).size).toBe(1);

    // Restore through the trash: the PROJECT handler registered by the module.
    const trash = await http()
      .post('/api/v1/trash/restore')
      .set('Authorization', as('ADMIN'))
      .send({ entityType: 'PROJECT', entityId: two.id })
      .expect(200);
    expect(trash.body.entity).toMatchObject({ type: 'PROJECT', id: two.id });
    expect((await admin.project.findUnique({ where: { id: two.id } }))?.deletedAt).toBeNull();
    const restoreEntries = await admin.activityLog.count({
      where: { entityType: 'PROJECT', entityId: two.id, action: 'RESTORE' },
    });
    expect(restoreEntries).toBe(1);
    await http()
      .post('/api/v1/trash/restore')
      .set('Authorization', as('MEMBER'))
      .send({ entityType: 'PROJECT', entityId: one.id })
      .expect(403);
  });

  it('tags a project through POST /tags/assign (the PROJECT resolver is registered) and filters by tag', async () => {
    const { id } = await createProject();
    const tag = await admin.tag.create({ data: { name: 'E2E tag proyecto', color: '#112233' } });
    await http()
      .post('/api/v1/tags/assign')
      .set('Authorization', as('MEMBER'))
      .send({ entityType: 'PROJECT', entityId: id, tagIds: [tag.id] })
      .expect(200);
    const list = await http()
      .get(`${BASE}?tagId=${tag.id}`)
      .set('Authorization', as('VIEWER'))
      .expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      id,
      tags: [{ id: tag.id, name: 'E2E tag proyecto', color: '#112233' }],
    });
  });

  it('documents every project EntityRef as the shared EntityRef schema (api-contract.md §2)', () => {
    const document = buildOpenApiDocument(app);
    const schemas = (document.components?.schemas ?? {}) as Record<
      string,
      {
        properties?: Record<
          string,
          { $ref?: string; items?: { properties?: Record<string, { $ref?: string }> } }
        >;
      }
    >;
    const ref = '#/components/schemas/EntityRef';
    const restoreResponse = document.paths?.[`${BASE}/{id}/restore`]?.post?.responses?.[
      '200'
    ] as unknown as {
      content: { 'application/json': { schema: { $ref: string } } };
    };
    const restored =
      schemas[restoreResponse.content['application/json'].schema.$ref.split('/').pop() ?? ''];
    expect(restored?.properties?.entity?.$ref).toBe(ref);
    const detail = Object.values(schemas).filter(
      (s) => s.properties?.clients?.items?.properties?.client,
    );
    expect(detail.length).toBeGreaterThan(0);
    for (const schema of detail) {
      expect(schema.properties?.clients?.items?.properties?.client?.$ref).toBe(ref);
    }
  });

  it('keeps the first project listed under both clients after all the traffic', async () => {
    const res = await http()
      .get(`${BASE}/${firstProjectId}`)
      .set('Authorization', as('OWNER'))
      .expect(200);
    expect(res.body.clients).toHaveLength(2);
  });
});
