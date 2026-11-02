import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import { GraphModule } from '../../../src/modules/intelligence/graph.module';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { AUTHORIZATION } from '../../../src/shared/application/ports/tokens';
import type { UserRole } from '../../../src/shared/domain/enums';
import { makeClient } from '../../db/helpers';
import { createTestPrisma } from '../../support/db';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { createTestApp } from '../../support/test-app';
import { at, must } from './must';
import { seedStudio, type Studio } from './seed';

const db = createTestPrisma();

interface Node {
  id: string;
  type: string;
  label: string;
  degree: number;
  archived: boolean;
  meta: Record<string, string | number | null>;
}
interface Graph {
  nodes: Node[];
  edges: { id: string; source: string; target: string; relation: string; label?: string }[];
  truncated: { nodeId: string; remaining: number; cursor: string }[];
  stats?: {
    nodeCount: number;
    edgeCount: number;
    mostConnected: { nodeId: string; degree: number }[];
  };
}

describe('graph (e2e)', () => {
  let app: NestExpressApplication;
  const tokens: Partial<Record<UserRole, string>> = {};
  let studio: Studio;

  beforeAll(async () => {
    const authenticator = new FakeAuthenticator();
    app = await createTestApp({
      modules: [GraphModule],
      authenticator,
      overrides: [{ token: AUTHORIZATION, useValue: new MatrixAuthorization() }],
    });
    for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const) {
      const row = await db.user.upsert({
        where: { clerkId: `clerk_graph_${role}` },
        update: {},
        create: { clerkId: `clerk_graph_${role}`, email: `${role}@graph.test`, name: role, role },
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
  }, 120_000);
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  beforeEach(async () => {
    // Keep the four role users across tests: they are not business data of the scenario.
    await db.$executeRawUnsafe(
      `DO $$ DECLARE r record; BEGIN
         FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
           AND tablename NOT IN ('_prisma_migrations','Currency','PaymentMethod','DocumentCategory','DocumentType','ExpenseCategory','Technology','Setting','Sequence','User')
         LOOP EXECUTE 'TRUNCATE TABLE "' || r.tablename || '" RESTART IDENTITY CASCADE'; END LOOP; END $$`,
    );
    await db.technology.deleteMany({ where: { slug: { startsWith: 'slug' } } });
    studio = await seedStudio(db);
  }, 60_000);

  const get = (role: UserRole | null, path: string) => {
    const req = request(app.getHttpServer()).get(`/api/v1${path}`);
    return role ? req.set('Authorization', `Bearer ${tokens[role]}`) : req;
  };
  const ids = (graph: Graph) => graph.nodes.map((n) => n.id).sort();
  const node = (type: string, id: string) => `${type}:${id}`;

  it('requires authentication', async () => {
    const res = await get(null, `/graph/CLIENT/${studio.kairos.id}`).expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    await get(null, '/graph').expect(401);
    await get(null, `/graph/nodes/CLIENT:${studio.kairos.id}/neighbours`).expect(401);
  });

  describe('HU-24 detail graph', () => {
    it('CA1: the client root with its direct neighbours, tags and technologies hidden', async () => {
      const res = await get('OWNER', `/graph/CLIENT/${studio.kairos.id}`).expect(200);
      const graph = res.body as Graph;
      const root = node('CLIENT', studio.kairos.id);
      expect(ids(graph)).toEqual(
        [
          root,
          node('CONTACT', studio.contact.id),
          node('PROJECT', studio.app.id),
          node('PROJECT', studio.erp.id),
          node('INVOICE', studio.invoice.id),
          node('PAYMENT', studio.payment.id),
          node('DOCUMENT', studio.document.id),
          node('NOTE', studio.note.id),
        ].sort(),
      );
      expect(graph.edges.every((e) => e.source === root || e.target === root)).toBe(true);
      expect(graph.nodes.find((n) => n.id === root)).toMatchObject({
        type: 'CLIENT',
        label: studio.kairos.tradeName,
        archived: false,
        // 1 contact + 2 projects + invoice + payment + document + note + tag
        degree: 8,
        meta: { receivableUsd: '120.50' },
      });
      expect(graph.truncated).toEqual([]);
      const role = graph.edges.find((e) => e.target === node('PROJECT', studio.app.id));
      expect(role).toMatchObject({ relation: 'participa', label: 'Dueño', source: root });
    });

    it('CA2: expanding a project yields its documents, invoices, expenses and clients', async () => {
      const res = await get('OWNER', `/graph/nodes/PROJECT:${studio.app.id}/neighbours`).expect(
        200,
      );
      expect(ids(res.body as Graph)).toEqual(
        [
          node('PROJECT', studio.app.id),
          node('CLIENT', studio.kairos.id),
          node('CLIENT', studio.mochima.id),
          node('INVOICE', studio.invoice.id),
          node('EXPENSE', studio.expense.id),
          node('DOCUMENT', studio.document.id),
        ].sort(),
      );
      const imputed = (res.body as Graph).edges.find((e) => e.relation === 'imputado_a');
      expect(imputed).toMatchObject({
        source: node('EXPENSE', studio.expense.id),
        target: node('PROJECT', studio.app.id),
      });
    });

    it('CA5: 50 neighbours per page, the rest truncated, the cursor loads the next page', async () => {
      await db.contact.createMany({
        data: Array.from({ length: 60 }, (_, i) => ({
          clientId: studio.kairos.id,
          fullName: `Bulk ${String(i).padStart(3, '0')}`,
        })),
      });
      const root = node('CLIENT', studio.kairos.id);
      const first = (await get('OWNER', `/graph/CLIENT/${studio.kairos.id}`).expect(200))
        .body as Graph;
      expect(first.nodes).toHaveLength(51);
      expect(first.truncated).toHaveLength(1);
      expect(first.truncated[0]).toMatchObject({ nodeId: root, cursor: '50' });
      const remaining = at(first.truncated, 0).remaining;
      const second = (
        await get(
          'OWNER',
          `/graph/nodes/${root}/neighbours?cursor=${at(first.truncated, 0).cursor}`,
        ).expect(200)
      ).body as Graph;
      expect(second.truncated).toEqual([]);
      const neighbours = (g: Graph) => g.nodes.filter((n) => n.id !== root).map((n) => n.id);
      expect(neighbours(second)).toHaveLength(remaining);
      expect(new Set([...neighbours(first), ...neighbours(second)]).size).toBe(50 + remaining);
    });

    it('include narrows, and tags and technologies appear when asked', async () => {
      const res = await get(
        'OWNER',
        `/graph/PROJECT/${studio.app.id}?include=TAG&include=TECHNOLOGY`,
      ).expect(200);
      const types = new Set((res.body as Graph).nodes.map((n) => n.type));
      expect([...types].sort()).toEqual(['PROJECT', 'TAG', 'TECHNOLOGY']);
    });

    it('depth 2 reaches the neighbours of the neighbours', async () => {
      const res = await get('OWNER', `/graph/CLIENT/${studio.kairos.id}?depth=2`).expect(200);
      expect(ids(res.body as Graph)).toContain(node('CLIENT', studio.mochima.id));
      expect(ids(res.body as Graph)).toContain(node('EXPENSE', studio.expense.id));
    });
  });

  describe('HU-25 global graph', () => {
    it('CA1: clients, projects and documents by default, with the label to look nodes up by name', async () => {
      const res = await get('OWNER', '/graph').expect(200);
      const graph = res.body as Graph;
      expect([...new Set(graph.nodes.map((n) => n.type))].sort()).toEqual([
        'CLIENT',
        'DOCUMENT',
        'PROJECT',
      ]);
      expect(graph.nodes).toHaveLength(5);
      expect(graph.nodes.find((n) => n.id === node('CLIENT', studio.kairos.id))?.label).toBe(
        studio.kairos.tradeName,
      );
      const nodeIds = new Set(graph.nodes.map((n) => n.id));
      expect(graph.edges.length).toBeGreaterThan(0);
      expect(graph.edges.every((e) => nodeIds.has(e.source) && nodeIds.has(e.target))).toBe(true);
      expect(graph.stats).toMatchObject({ nodeCount: 5, edgeCount: graph.edges.length });
      expect(at(must(graph.stats).mostConnected, 0).degree).toBeGreaterThanOrEqual(
        at(must(graph.stats).mostConnected, 1).degree,
      );
    });

    it('filters: types, statuses, technologies, tags, clients, dates and only active', async () => {
      const projects = (await get('OWNER', '/graph?include=PROJECT&statuses=EN_CURSO').expect(200))
        .body as Graph;
      expect(ids(projects)).toEqual([node('PROJECT', studio.app.id)]);
      const tech = (
        await get('OWNER', `/graph?include=PROJECT&technologyIds=${at(studio.stack, 0).id}`).expect(
          200,
        )
      ).body as Graph;
      expect(ids(tech)).toEqual([node('PROJECT', studio.app.id)]);
      const tagged = (
        await get('OWNER', `/graph?include=PROJECT&include=CLIENT&tagIds=${studio.tag.id}`).expect(
          200,
        )
      ).body as Graph;
      expect(ids(tagged)).toEqual(
        [node('CLIENT', studio.kairos.id), node('PROJECT', studio.app.id)].sort(),
      );
      const byClient = (await get('OWNER', `/graph?clientIds=${studio.mochima.id}`).expect(200))
        .body as Graph;
      expect(ids(byClient)).toEqual(
        [
          node('CLIENT', studio.mochima.id),
          node('PROJECT', studio.app.id),
          node('DOCUMENT', studio.document.id),
        ].sort(),
      );
      const dated = (
        await get('OWNER', '/graph?include=PROJECT&dateFrom=2026-07-01&dateTo=2026-07-31').expect(
          200,
        )
      ).body as Graph;
      expect(ids(dated)).toEqual([node('PROJECT', studio.app.id)]);
      const active = (await get('OWNER', '/graph?onlyActive=true').expect(200)).body as Graph;
      expect(active.nodes.length).toBeGreaterThan(0);
    });

    it('a Viewer asking for financial types gets the rest and no error', async () => {
      const res = await get(
        'VIEWER',
        '/graph?include=CLIENT&include=INVOICE&include=PAYMENT',
      ).expect(200);
      expect([...new Set((res.body as Graph).nodes.map((n) => n.type))]).toEqual(['CLIENT']);
    });

    it('loads 500 nodes and reports the time', async () => {
      const clients = Array.from({ length: 100 }, (_, i) => ({
        id: `perf_cli_${i}`,
        code: `PCLI-${i}`,
        kind: 'EMPRESA' as const,
        tradeName: `Perf Client ${i}`,
        legalName: `Perf Legal ${i}`,
        taxId: `J-PERF-${i}`,
        country: 'VE',
        address: 'Test address',
        phone: '+58 000 0000',
      }));
      await db.client.createMany({ data: clients });
      const projects = Array.from({ length: 150 }, (_, i) => ({
        id: `perf_pry_${i}`,
        code: `PPRY-${i}`,
        name: `Perf Project ${i}`,
        summary: 'summary',
      }));
      await db.project.createMany({ data: projects });
      await db.projectClient.createMany({
        data: projects.map((p, i) => ({ projectId: p.id, clientId: at(clients, i % 100).id })),
      });
      const documents = Array.from({ length: 250 }, (_, i) => ({
        id: `perf_doc_${i}`,
        code: `PDOC-${i}`,
        title: `Perf Document ${i}`,
        typeId: 'dtyp_prd',
      }));
      await db.document.createMany({ data: documents });
      await db.documentLink.createMany({
        data: documents.map((d, i) =>
          i % 2 === 0
            ? { documentId: d.id, clientId: at(clients, i % 100).id }
            : { documentId: d.id, projectId: at(projects, i % 150).id },
        ),
      });
      const started = performance.now();
      const res = await get('OWNER', '/graph').expect(200);
      const elapsed = Math.round(performance.now() - started);
      const graph = res.body as Graph;
      console.info(
        `graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges in ${elapsed} ms`,
      );
      expect(graph.nodes.length).toBeGreaterThanOrEqual(500);
      expect(elapsed).toBeLessThan(3_000);
    });
  });

  describe('visibility (C13, C14)', () => {
    it('a Member sees no invoice or payment node, and degree excludes them', async () => {
      const res = await get('MEMBER', `/graph/CLIENT/${studio.kairos.id}`).expect(200);
      const graph = res.body as Graph;
      const types = new Set(graph.nodes.map((n) => n.type));
      expect(types.has('INVOICE')).toBe(false);
      expect(types.has('PAYMENT')).toBe(false);
      const root = must(graph.nodes.find((n) => n.id === node('CLIENT', studio.kairos.id)));
      expect(root.degree).toBe(6);
      expect(root.meta.receivableUsd).toBeNull();
    });

    it('an unreadable root is 403 without probing for existence, an invisible one is 404', async () => {
      const res = await get('MEMBER', `/graph/INVOICE/${studio.invoice.id}`).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      await get('VIEWER', '/graph/INVOICE/inv_missing').expect(403);
      await get('VIEWER', `/graph/nodes/PAYMENT:${studio.payment.id}/neighbours`).expect(403);
      const missing = await get('OWNER', '/graph/CLIENT/cli_missing').expect(404);
      expect(missing.body.error.code).toBe('NOT_FOUND');
    });

    it('a Viewer reads clients and projects but no financial node', async () => {
      const res = await get('VIEWER', `/graph/PROJECT/${studio.app.id}`).expect(200);
      const types = new Set((res.body as Graph).nodes.map((n) => n.type));
      expect(types.has('EXPENSE')).toBe(false);
      expect(types.has('INVOICE')).toBe(false);
      expect(types.has('CLIENT')).toBe(true);
    });

    it('answers no file key, token or hash anywhere', async () => {
      const bodies = await Promise.all([
        get('OWNER', `/graph/DOCUMENT/${studio.document.id}?depth=3`),
        get(
          'OWNER',
          '/graph?include=CLIENT&include=PROJECT&include=DOCUMENT&include=NOTE&include=INVOICE',
        ),
      ]);
      for (const res of bodies) {
        for (const forbidden of [
          'storageKey',
          'bucket',
          'sha256',
          'tokenHash',
          'accessKey',
          'fileId',
        ]) {
          expect(JSON.stringify(res.body)).not.toContain(forbidden);
        }
      }
    });
  });

  describe('HU-28 CA1 archived nodes', () => {
    it('hidden by default, shown with the toggle to Owner and Admin only', async () => {
      const archived = node('CONTACT', studio.archivedContact.id);
      await db.contact.update({
        where: { id: studio.archivedContact.id },
        data: { deletedAt: studio.archivedAt },
      });
      const hidden = (await get('OWNER', `/graph/CLIENT/${studio.kairos.id}`).expect(200))
        .body as Graph;
      expect(ids(hidden)).not.toContain(archived);
      const shown = (
        await get('ADMIN', `/graph/CLIENT/${studio.kairos.id}?includeArchived=true`).expect(200)
      ).body as Graph;
      expect(shown.nodes.find((n) => n.id === archived)?.archived).toBe(true);
      const member = (
        await get('MEMBER', `/graph/CLIENT/${studio.kairos.id}?includeArchived=true`).expect(200)
      ).body as Graph;
      expect(ids(member)).not.toContain(archived);
    });

    it('an archived root is 404 for roles without the trash grant', async () => {
      const client = await makeClient(db);
      await db.client.update({ where: { id: client.id }, data: { deletedAt: studio.archivedAt } });
      await get('MEMBER', `/graph/CLIENT/${client.id}`).expect(404);
      const res = await get('OWNER', `/graph/CLIENT/${client.id}?includeArchived=true`).expect(200);
      expect((res.body as Graph).nodes[0]).toMatchObject({ archived: true });
    });
  });

  describe('input is validated (422)', () => {
    it.each([
      ['/graph/LEAD/abc'],
      ['/graph/CLIENT/bad%20id'],
      ['/graph/CLIENT/abc?depth=0'],
      ['/graph/CLIENT/abc?depth=4'],
      ['/graph/CLIENT/abc?include=LEAD'],
      ['/graph/nodes/nonsense/neighbours'],
      ['/graph/nodes/CLIENT:abc/neighbours?cursor=abc'],
      ['/graph?include=LEAD'],
      ['/graph?dateFrom=2026-13-40'],
      ['/graph?dateFrom=2026-08-01&dateTo=2026-07-01'],
    ])('%s', async (path) => {
      const res = await get('OWNER', path);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION');
    });

    it('SQL metacharacters in ids and filters are inert', async () => {
      await get(
        'OWNER',
        `/graph/CLIENT/${encodeURIComponent('x\'; DROP TABLE "Client";--')}`,
      ).expect(422);
      await get('OWNER', `/graph?statuses=${encodeURIComponent("' OR 1=1 --")}`).expect(200);
      expect(await db.client.count()).toBeGreaterThan(0);
    });
  });
});
