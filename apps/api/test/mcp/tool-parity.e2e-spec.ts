import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestPrisma } from '../support/db';
import { connect, seedWorld, startMcpApp, V1, type McpWorld } from './harness';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

/**
 * Contract choice 4: a tool answers the same JSON as its HTTP route. Here the data is not empty, so the
 * mappers the tools share with the controllers (one per context) are exercised with real rows, money included.
 */
describe('MCP tool bodies equal their HTTP bodies over seeded data (contract choice 4)', () => {
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

  const get = (path: string) =>
    request(base.app.getHttpServer())
      .get(`${V1}${path}`)
      .set({ Authorization: `Bearer ${world.sessions.OWNER}` });
  const post = (path: string, body: object) =>
    request(base.app.getHttpServer())
      .post(`${V1}${path}`)
      .set({ Authorization: `Bearer ${world.sessions.OWNER}` })
      .send(body);

  it('commercial, finance and intelligence tools answer the HTTP body of a populated database', async () => {
    const client = (
      await post('/clients', {
        kind: 'EMPRESA',
        tradeName: 'Nube Austral',
        legalName: 'Nube Austral C.A.',
        taxId: 'J-40111222-3',
        country: 'VE',
        address: 'Av. Principal, Caracas',
        phone: '+584121234567',
      }).expect(201)
    ).body;
    const project = (
      await post('/projects', {
        name: 'Sitio web',
        summary: 'Sitio institucional',
        description: doc('Alcance inicial'),
        clients: [{ clientId: client.id }],
        links: [{ group: 'REPOSITORIO', label: 'Repo', url: 'https://example.test/repo' }],
      }).expect(201)
    ).body;
    const note = (
      await post('/notes', {
        title: 'Reunion',
        content: doc('Acuerdos'),
        links: [{ entityType: 'CLIENT', entityId: client.id }],
      }).expect(201)
    ).body;
    const invoice = (
      await post('/invoices', {
        clientId: client.id,
        invoiceNumber: 'F-9001',
        issueDate: '2099-01-01',
        dueDate: '2099-02-01',
        currency: 'USD',
        usdRate: '1',
        lines: [
          { description: 'Desarrollo', projectId: project.id, unitPrice: '1000.00', ivaRate: '16' },
        ],
      }).expect(201)
    ).body;
    expect(invoice.totals.total).toBe('1160.00');

    const pairs: [string, Record<string, unknown>, string][] = [
      ['get_client', { id: client.id }, `/clients/${client.id}`],
      ['list_clients', {}, '/clients'],
      ['get_project', { id: project.id }, `/projects/${project.id}`],
      ['list_projects', {}, '/projects'],
      ['get_note', { id: note.id }, `/notes/${note.id}`],
      ['list_notes', {}, '/notes'],
      ['get_invoice', { id: invoice.id }, `/invoices/${invoice.id}`],
      ['list_invoices', {}, '/invoices'],
      ['list_open_invoices', { clientId: client.id }, `/clients/${client.id}/open-invoices`],
      ['search', { q: 'Nube' }, '/search?q=Nube'],
      ['get_dashboard', {}, '/dashboard'],
      ['list_alerts', {}, '/alerts'],
    ];
    const mcp = await connect(world, world.secrets.OWNER);
    for (const [tool, args, path] of pairs) {
      const outcome = await mcp.call(tool, args);
      expect(outcome.isError, tool).toBe(false);
      expect(outcome.body, tool).toEqual((await get(path).expect(200)).body);
    }
    // Money rides as a decimal string in both shapes (DT-181 6a).
    expect((await mcp.call('get_project', { id: project.id })).body.invoicedUsd).toMatch(
      /^-?\d+(\.\d+)?$/,
    );
    await mcp.close();
  });
});
