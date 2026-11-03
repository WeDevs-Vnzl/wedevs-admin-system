import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpToolRegistry } from '../../src/shared/interface/mcp-tool-registry';
import { readRouteGrant } from '../../src/shared/interface/grant.decorator';
import { createTestPrisma } from '../support/db';
import { connect, seedWorld, startMcpApp, V1, type Json, type McpWorld } from './harness';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

/** DT-188 minus DT-198: the exact tool set. */
const READ_TOOLS = [
  'search',
  'get_client',
  'list_clients',
  'list_contacts',
  'get_project',
  'list_projects',
  'get_note',
  'list_notes',
  'get_invoice',
  'list_invoices',
  'list_open_invoices',
  'get_payment',
  'list_payments',
  'get_dashboard',
  'get_kpis',
  'list_alerts',
];
const WRITE_TOOLS = [
  'create_client',
  'update_client',
  'set_client_status',
  'create_contact',
  'update_contact',
  'set_primary_contact',
  'create_note',
  'update_note',
  'pin_note',
  'link_note',
  'unlink_note',
];
/** DT-198: never tools. */
const NOT_EXPOSED = [
  'archive_clients',
  'archive_client',
  'restore_client',
  'archive_contact',
  'restore_contact',
  'archive_note',
  'restore_note',
  'attach_note_file',
];

/** The HTTP route each tool stands for, to compare declared grants (DT-195). */
const ROUTE_OF: Readonly<Record<string, string>> = {
  search: 'GET /api/v1/search',
  get_client: 'GET /api/v1/clients/{id}',
  list_clients: 'GET /api/v1/clients',
  list_contacts: 'GET /api/v1/clients/{id}/contacts',
  get_project: 'GET /api/v1/projects/{id}',
  list_projects: 'GET /api/v1/projects',
  get_note: 'GET /api/v1/notes/{id}',
  list_notes: 'GET /api/v1/notes',
  get_invoice: 'GET /api/v1/invoices/{id}',
  list_invoices: 'GET /api/v1/invoices',
  list_open_invoices: 'GET /api/v1/clients/{id}/open-invoices',
  get_payment: 'GET /api/v1/payments/{id}',
  list_payments: 'GET /api/v1/payments',
  get_dashboard: 'GET /api/v1/dashboard',
  get_kpis: 'GET /api/v1/reports/kpis',
  list_alerts: 'GET /api/v1/alerts',
  create_client: 'POST /api/v1/clients',
  update_client: 'PATCH /api/v1/clients/{id}',
  set_client_status: 'POST /api/v1/clients/{id}/status',
  create_contact: 'POST /api/v1/clients/{id}/contacts',
  update_contact: 'PATCH /api/v1/contacts/{id}',
  set_primary_contact: 'POST /api/v1/contacts/{id}/primary',
  create_note: 'POST /api/v1/notes',
  update_note: 'PATCH /api/v1/notes/{id}',
  pin_note: 'POST /api/v1/notes/{id}/pin',
  link_note: 'POST /api/v1/notes/{id}/links',
  unlink_note: 'POST /api/v1/notes/{id}/unlink',
};

const toArray = (value: unknown): string[] => (Array.isArray(value) ? value : [value]) as string[];
const joinPath = (...parts: string[]) =>
  `/${parts
    .flatMap((p) => p.split('/'))
    .filter((s) => s.length > 0)
    .join('/')}`;

/** `METHOD /path` to the grant its handler declares (`resource:action` or `authenticated`). */
function routeGrants(app: NestExpressApplication): Map<string, string> {
  const out = new Map<string, string>();
  for (const module of app.get(ModulesContainer, { strict: false }).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype;
      if (!controller) continue;
      const prototype = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const method = Reflect.getMetadata('method', handler) as RequestMethod | undefined;
        if (method === undefined) continue;
        for (const base of toArray(Reflect.getMetadata('path', controller) ?? '')) {
          for (const sub of toArray(Reflect.getMetadata('path', handler) ?? '')) {
            const grant = readRouteGrant(handler as never, controller);
            const route = `${RequestMethod[method]} ${joinPath('api', 'v1', base, sub).replace(/:(\w+)/g, '{$1}')}`;
            out.set(
              route,
              grant.kind === 'grant' ? `${grant.resource}:${grant.action}` : grant.kind,
            );
          }
        }
      }
    }
  }
  return out;
}

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const clientForm = (over: Record<string, unknown> = {}) => ({
  kind: 'EMPRESA',
  tradeName: 'Nube Austral',
  legalName: 'Nube Austral C.A.',
  taxId: 'J-40111222-3',
  country: 'VE',
  address: 'Av. Principal, Caracas',
  phone: '+584121234567',
  ...over,
});

describe('MCP server (e2e): DT-188, DT-189, DT-190, DT-195, DT-198', () => {
  const prisma = createTestPrisma();
  let base: Awaited<ReturnType<typeof startMcpApp>>;
  let world: McpWorld;

  beforeAll(async () => {
    base = await startMcpApp();
  });
  beforeEach(async () => {
    world = await seedWorld(base, prisma);
  });
  afterAll(async () => {
    await base.app.close();
    await prisma.$disconnect();
  });

  const http = () => request(base.app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (path: string, role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' = 'OWNER') =>
    http().get(`${V1}${path}`).set(bearer(world.sessions[role]));
  const post = (path: string, body: object, role: 'OWNER' | 'ADMIN' = 'OWNER') =>
    http().post(`${V1}${path}`).set(bearer(world.sessions[role])).send(body);
  const registry = () => base.app.get(McpToolRegistry, { strict: false });

  describe('transport and authentication', () => {
    const initialize = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'raw', version: '1' },
      },
    };
    const raw = () =>
      http()
        .post(`${V1}/mcp`)
        .set('Accept', 'application/json, text/event-stream')
        .set('Content-Type', 'application/json');

    it('answers 401 UNAUTHENTICATED with no Authorization header', async () => {
      const res = await raw().send(initialize);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('answers 401 for a Clerk session JWT: /mcp takes personal access tokens only (DT-190)', async () => {
      const res = await raw().set(bearer(world.sessions.OWNER)).send(initialize);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('answers 401 for a revoked token on the next call', async () => {
      const mcp = await connect(world, world.secrets.OWNER);
      expect((await mcp.call('list_clients')).isError).toBe(false);
      const [row] = await prisma.apiToken.findMany({ where: { userId: world.users.OWNER.userId } });
      await http()
        .post(`${V1}/me/api-tokens/${row?.id}/revoke`)
        .set(bearer(world.sessions.OWNER))
        .expect(200);
      const res = await raw().set(bearer(world.secrets.OWNER)).send(initialize);
      expect(res.status).toBe(401);
      await mcp.close().catch(() => undefined);
    });

    it('initializes over stateless Streamable HTTP with a valid token, as plain JSON', async () => {
      const res = await raw().set(bearer(world.secrets.OWNER)).send(initialize);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.headers['mcp-session-id']).toBeUndefined();
      expect(res.body.result.serverInfo.name).toBe('wedevs-core');
    });

    it('serves no GET stream: the server is stateless (405, Allow: POST)', async () => {
      const res = await http().get(`${V1}/mcp`).set(bearer(world.secrets.OWNER));
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('POST');
    });

    it('has no session to delete: DELETE answers 405 with Allow: POST', async () => {
      const res = await http().delete(`${V1}/mcp`).set(bearer(world.secrets.OWNER));
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('POST');
    });
  });

  describe('the tool list', () => {
    it('is exactly DT-188 minus DT-198, equal to the registry and no more', async () => {
      const mcp = await connect(world, world.secrets.OWNER);
      const listed = (await mcp.client.listTools()).tools.map((t) => t.name).sort();
      await mcp.close();
      expect(listed).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
      expect(listed).toEqual(
        registry()
          .list()
          .map((t) => t.name)
          .sort(),
      );
      expect(READ_TOOLS).toHaveLength(16);
      expect(WRITE_TOOLS).toHaveLength(11);
    });

    it('registers none of the archive, restore and attach tools (DT-198)', () => {
      const names = registry()
        .list()
        .map((t) => t.name);
      for (const hidden of NOT_EXPOSED) expect(names).not.toContain(hidden);
      expect(names.filter((n) => /archive|restore|attach|delete/.test(n))).toEqual([]);
    });

    it('describes every tool with an object JSON Schema', async () => {
      const mcp = await connect(world, world.secrets.OWNER);
      const { tools } = await mcp.client.listTools();
      await mcp.close();
      for (const tool of tools) {
        expect(tool.inputSchema.type, tool.name).toBe('object');
        expect(tool.description, tool.name).toBeTruthy();
      }
      const update = tools.find((t) => t.name === 'update_client');
      expect(Object.keys(update?.inputSchema.properties ?? {})).toEqual(
        expect.arrayContaining(['id', 'tradeName', 'taxId']),
      );
    });
  });

  describe('grants', () => {
    it("each tool's declared grant equals its HTTP route's in the route inventory", () => {
      const routes = routeGrants(base.app);
      const tools = registry().list();
      expect(Object.keys(ROUTE_OF).sort()).toEqual(tools.map((t) => t.name).sort());
      for (const tool of tools) {
        const route = ROUTE_OF[tool.name] ?? '';
        const declared = routes.get(route);
        expect(declared, `${tool.name} -> ${route}`).toBeDefined();
        const { grant } = tool;
        const toolGrant =
          grant === 'authenticated' ? 'authenticated' : `${grant.resource}:${grant.action}`;
        expect(toolGrant, tool.name).toBe(declared);
      }
    });

    it('refuses every grant-bearing tool FORBIDDEN without the grant: the use case is not called and nothing is written', async () => {
      const mcp = await connect(world, world.secrets.OWNER);
      base.authorization.denyAll = true;
      const before = {
        clients: await prisma.client.count(),
        notes: await prisma.note.count(),
        activity: await prisma.activityLog.count(),
      };
      let checked = 0;
      for (const tool of registry().list()) {
        if ((tool.grant as unknown) === 'authenticated') continue;
        const spy = vi.spyOn(tool, 'handler');
        const outcome = await mcp.call(tool.name, {});
        expect(outcome.isError, tool.name).toBe(true);
        expect(outcome.body.error.code, tool.name).toBe('FORBIDDEN');
        expect(spy, tool.name).not.toHaveBeenCalled();
        spy.mockRestore();
        checked += 1;
      }
      base.authorization.denyAll = false;
      await mcp.close();
      expect(checked).toBe(READ_TOOLS.length + WRITE_TOOLS.length - 3);
      expect({
        clients: await prisma.client.count(),
        notes: await prisma.note.count(),
        activity: await prisma.activityLog.count(),
      }).toEqual(before);
    });

    it('the real matrix: a Member token is refused the write tools and every finance read, nothing written', async () => {
      const member = await connect(world, world.secrets.MEMBER);
      const clientsBefore = await prisma.client.count();
      const activityBefore = await prisma.activityLog.count();
      const refused = await member.call('create_client', clientForm());
      expect(refused.isError).toBe(true);
      expect(refused.body.error.code).toBe('FORBIDDEN');
      for (const name of ['list_invoices', 'list_payments', 'get_kpis']) {
        expect((await member.call(name, {})).body.error.code, name).toBe('FORBIDDEN');
      }
      await member.close();
      expect(await prisma.client.count()).toBe(clientsBefore);
      expect(await prisma.activityLog.count()).toBe(activityBefore);
    });

    it('a Viewer token reads but cannot write notes', async () => {
      const owner = await connect(world, world.secrets.OWNER);
      const client = (await owner.call('create_client', clientForm())).body;
      await owner.close();
      const viewer = await connect(world, world.secrets.VIEWER);
      expect((await viewer.call('list_clients')).isError).toBe(false);
      const outcome = await viewer.call('create_note', {
        content: doc('x'),
        links: [{ entityType: 'CLIENT', entityId: client.id }],
      });
      await viewer.close();
      expect(outcome.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('the Owner succeeds, with the same body as the HTTP route', () => {
    it('clients, contacts and notes: writes then reads', async () => {
      const mcp = await connect(world, world.secrets.OWNER);
      const created = await mcp.call('create_client', clientForm());
      expect(created.isError).toBe(false);
      expect(created.body.code).toMatch(/^CLI-\d{4}$/);
      const id = created.body.id as string;

      const got = await mcp.call('get_client', { id });
      expect(got.body).toEqual((await get(`/clients/${id}`).expect(200)).body);
      const listed = await mcp.call('list_clients', {});
      expect(listed.body).toEqual((await get('/clients').expect(200)).body);

      const updated = await mcp.call('update_client', {
        id,
        ...clientForm({ tradeName: 'Nube Austral 2' }),
      });
      expect(updated.body.tradeName).toBe('Nube Austral 2');
      const status = await mcp.call('set_client_status', { id, status: 'ACTIVO' });
      expect(status.body.status).toBe('ACTIVO');

      const contact = await mcp.call('create_contact', {
        clientId: id,
        fullName: 'Ana Pérez',
        email: 'ana@example.test',
      });
      expect(contact.isError).toBe(false);
      const second = await mcp.call('create_contact', {
        clientId: id,
        fullName: 'Luis Gil',
        email: 'luis@example.test',
      });
      await mcp.call('update_contact', { id: second.body.id, fullName: 'Luis Gil Ruiz' });
      const primary = await mcp.call('set_primary_contact', { id: second.body.id });
      expect(primary.body.isPrimary).toBe(true);
      const contacts = await mcp.call('list_contacts', { clientId: id });
      expect(contacts.body).toEqual((await get(`/clients/${id}/contacts`).expect(200)).body);

      const note = await mcp.call('create_note', {
        title: 'Alcance',
        content: doc('Alcance acordado'),
        links: [{ entityType: 'CLIENT', entityId: id }],
      });
      expect(note.isError).toBe(false);
      const noteId = note.body.id as string;
      expect(
        (
          await mcp.call('update_note', {
            id: noteId,
            title: 'Alcance v2',
            content: doc('v2'),
            tagIds: [],
          })
        ).body.title,
      ).toBe('Alcance v2');
      expect((await mcp.call('pin_note', { id: noteId, pinned: true })).body.pinned).toBe(true);
      const linked = await mcp.call('link_note', {
        id: noteId,
        entityType: 'CONTACT',
        entityId: contact.body.id,
      });
      expect(linked.body.links).toHaveLength(2);
      const unlinked = await mcp.call('unlink_note', {
        id: noteId,
        entityType: 'CONTACT',
        entityId: contact.body.id,
      });
      expect(unlinked.body.links).toHaveLength(1);
      expect((await mcp.call('get_note', { id: noteId })).body).toEqual(
        (await get(`/notes/${noteId}`).expect(200)).body,
      );
      expect((await mcp.call('list_notes', {})).body).toEqual(
        (await get('/notes').expect(200)).body,
      );
      await mcp.close();
    });

    it('projects, invoices, payments and the intelligence reads answer the HTTP body', async () => {
      const mcp = await connect(world, world.secrets.OWNER);
      const client = (await mcp.call('create_client', clientForm())).body;
      const pairs: [string, Record<string, unknown>, string][] = [
        ['list_projects', {}, '/projects'],
        ['list_invoices', {}, '/invoices'],
        ['list_payments', {}, '/payments'],
        ['list_open_invoices', { clientId: client.id }, `/clients/${client.id}/open-invoices`],
        ['get_kpis', {}, '/reports/kpis'],
        ['get_dashboard', {}, '/dashboard'],
        ['list_alerts', {}, '/alerts'],
        ['search', { q: 'Nube' }, '/search?q=Nube'],
      ];
      for (const [tool, args, path] of pairs) {
        const outcome = await mcp.call(tool, args);
        expect(outcome.isError, tool).toBe(false);
        expect(outcome.body, tool).toEqual((await get(path).expect(200)).body);
      }
      await mcp.close();
    });

    it('answers NOT_FOUND for an unknown id and VALIDATION with field errors for bad arguments', async () => {
      const mcp = await connect(world, world.secrets.OWNER);
      for (const [name, id] of [
        ['get_project', 'does-not-exist'],
        ['get_invoice', 'does-not-exist'],
        ['get_payment', 'does-not-exist'],
      ] as const) {
        const outcome = await mcp.call(name, { id });
        expect(outcome.body.error.code, name).toMatch(/^(NOT_FOUND|VALIDATION)$/);
      }
      const bad = await mcp.call('create_client', { kind: 'EMPRESA' });
      expect(bad.isError).toBe(true);
      expect(bad.body.error.code).toBe('VALIDATION');
      expect(Object.keys(bad.body.error.fieldErrors as object)).toContain('tradeName');
      const unknown = await mcp.call('archive_client', { id: 'x' });
      expect(unknown.body.error.code).toBe('NOT_FOUND');
      await mcp.close();
    });
  });

  describe('activity entries (A8)', () => {
    /** The part of an activity entry that does not depend on ids, codes or the record's own values. */
    async function shape(entityType: string, entityId: string) {
      const rows = await prisma.activityLog.findMany({
        where: { entityType: entityType as never, entityId },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map((row) => ({
        actorType: row.actorType,
        actorId: row.actorId,
        action: row.action,
        entityType: row.entityType,
        changes: Object.keys((row.changes ?? {}) as object).sort(),
        metadata: Object.keys((row.metadata ?? {}) as object).sort(),
      }));
    }

    it('a write tool records the same entry as its HTTP route, with the token user as the actor', async () => {
      const mcp = await connect(world, world.secrets.OWNER);
      const viaMcp = (await mcp.call('create_client', clientForm({ taxId: 'J-40111222-3' }))).body;
      const viaHttp = (await post('/clients', clientForm({ taxId: 'J-50222333-4' })).expect(201))
        .body;
      await mcp.call('set_client_status', { id: viaMcp.id, status: 'ACTIVO' });
      await post(`/clients/${viaHttp.id}/status`, { status: 'ACTIVO' }).expect(200);
      const contactMcp = (
        await mcp.call('create_contact', {
          clientId: viaMcp.id,
          fullName: 'Ana Pérez',
          email: 'ana@example.test',
        })
      ).body;
      const contactHttp = (
        await post(`/clients/${viaHttp.id}/contacts`, {
          fullName: 'Ana Pérez',
          email: 'ana@example.test',
        }).expect(201)
      ).body;
      expect(contactMcp.id).toBeTruthy();
      const noteMcp = (
        await mcp.call('create_note', {
          content: doc('x'),
          links: [{ entityType: 'CLIENT', entityId: viaMcp.id }],
        })
      ).body;
      const noteHttp = (
        await post('/notes', {
          content: doc('x'),
          links: [{ entityType: 'CLIENT', entityId: viaHttp.id }],
        }).expect(201)
      ).body;
      expect(noteMcp.id).toBeTruthy();
      await mcp.call('pin_note', { id: noteMcp.id, pinned: true });
      await post(`/notes/${noteHttp.id}/pin`, { pinned: true }).expect(200);
      await mcp.close();

      for (const [type, a, b] of [
        ['CLIENT', viaMcp.id, viaHttp.id],
        ['CONTACT', contactMcp.id, contactHttp.id],
        ['NOTE', noteMcp.id, noteHttp.id],
      ] as const) {
        const mine = await shape(type, a);
        expect(mine.length, type).toBeGreaterThan(0);
        expect(mine, type).toEqual(await shape(type, b));
        for (const entry of mine) {
          expect(entry.actorType).toBe('USER');
          expect(entry.actorId).toBe(world.users.OWNER.userId);
        }
      }
    });
  });

  describe('secrets and logs (A9)', () => {
    it('no token secret reaches a log line through /mcp, success or refusal', async () => {
      const lines: string[] = [];
      const push = (chunk: unknown) => {
        lines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString());
        return true;
      };
      vi.spyOn(process.stdout, 'write').mockImplementation(push as never);
      vi.spyOn(process.stderr, 'write').mockImplementation(push as never);
      try {
        const mcp = await connect(world, world.secrets.OWNER);
        await mcp.call('create_client', clientForm());
        await mcp.call('create_client', {});
        await mcp.call('does_not_exist', {});
        await mcp.close();
        await http()
          .post(`${V1}/mcp`)
          .set(bearer(`${world.secrets.OWNER}x`))
          .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
      } finally {
        vi.restoreAllMocks();
      }
      const all = lines.join('\n');
      for (const secret of Object.values(world.secrets)) expect(all).not.toContain(secret);
      expect(all).not.toMatch(/wdc_pat_[A-Za-z0-9_-]{43}/);
    });
  });
});

export type { Json };
