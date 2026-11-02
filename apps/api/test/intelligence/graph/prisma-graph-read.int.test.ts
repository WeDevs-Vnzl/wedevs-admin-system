import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../../src/generated/prisma/client';
import {
  GRAPH_NODE_TYPE_VALUES,
  type GraphNodeType,
  type GraphReadScope,
  type GraphRef,
} from '../../../src/modules/intelligence/application/ports/graph-read.port';
import { PrismaGraphRead } from '../../../src/modules/intelligence/infrastructure/prisma-graph-read.adapter';
import { graphNodeId } from '../../../src/modules/intelligence/domain';
import type { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { softDeleteExtension } from '../../../src/shared/infrastructure/prisma/soft-delete.extension';
import { TransactionHost } from '../../../src/shared/infrastructure/prisma/transaction-host';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { at, must } from './must';
import { seedStudio, type Studio } from './seed';

const admin = createTestPrisma();
const queries: string[] = [];
const base = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL as string }),
  log: [{ emit: 'event', level: 'query' }],
});
base.$on('query', (event) => queries.push(event.query));
const service = { client: base.$extends(softDeleteExtension) } as unknown as PrismaService;
const read = new PrismaGraphRead(new TransactionHost(service));

const ALL: GraphReadScope = { types: new Set(GRAPH_NODE_TYPE_VALUES), financials: true };
const COMMERCIAL: GraphReadScope = {
  types: new Set<GraphNodeType>([
    'CLIENT',
    'CONTACT',
    'PROJECT',
    'DOCUMENT',
    'NOTE',
    'TECHNOLOGY',
    'TAG',
  ]),
  financials: false,
};
const ref = (type: GraphNodeType, id: string): GraphRef => ({ type, id });
const key = (type: GraphNodeType, id: string): string => graphNodeId(type, id);

let studio: Studio;

beforeAll(() => truncateBusinessTables(admin));
beforeEach(async () => {
  await truncateBusinessTables(admin);
  studio = await seedStudio(admin);
  queries.length = 0;
}, 60_000);
afterAll(async () => {
  await base.$disconnect();
  await admin.$disconnect();
});

describe('PrismaGraphRead.facts', () => {
  it('builds the card of every node type', async () => {
    const refs = [
      ref('CLIENT', studio.kairos.id),
      ref('CONTACT', studio.contact.id),
      ref('PROJECT', studio.app.id),
      ref('INVOICE', studio.invoice.id),
      ref('PAYMENT', studio.payment.id),
      ref('EXPENSE', studio.expense.id),
      ref('ACCOUNT', studio.account.id),
      ref('DOCUMENT', studio.document.id),
      ref('NOTE', studio.note.id),
      ref('TECHNOLOGY', at(studio.stack, 0).id),
      ref('TAG', studio.tag.id),
    ];
    const facts = await read.facts(refs, ALL);
    expect([...facts.keys()].sort()).toEqual(refs.map((r) => key(r.type, r.id)).sort());
    const client = must(facts.get(key('CLIENT', studio.kairos.id)));
    expect(client).toMatchObject({
      label: studio.kairos.tradeName,
      code: studio.kairos.code,
      status: 'PROSPECTO',
      archived: false,
      meta: { kind: 'EMPRESA', country: 'VE', receivableUsd: '120.50' },
    });
    expect(facts.get(key('INVOICE', studio.invoice.id))).toMatchObject({
      label: studio.invoice.invoiceNumber,
      status: 'EMITIDA',
      meta: { currency: 'USD', total: '116.00', balance: '116.00', dueDate: '2026-01-15' },
      date: '2026-01-15',
    });
    expect(facts.get(key('PAYMENT', studio.payment.id))).toMatchObject({
      meta: { currency: 'USD', amount: '116.00', date: '2026-01-15' },
    });
    expect(facts.get(key('EXPENSE', studio.expense.id))?.meta).toMatchObject({ amount: '20.00' });
    expect(facts.get(key('ACCOUNT', studio.account.id))?.meta).toMatchObject({
      currency: 'USD',
      accountType: 'BANCO_NACIONAL',
    });
    expect(facts.get(key('DOCUMENT', studio.document.id))?.meta).toEqual({
      documentType: expect.any(String),
      version: null,
    });
    expect(facts.get(key('NOTE', studio.note.id))).toMatchObject({
      label: 'Llamada con el cliente sobre el',
      meta: { author: 'Ana Autora', excerpt: 'Llamada con el cliente sobre el alcance' },
    });
    expect(facts.get(key('TAG', studio.tag.id))?.meta).toEqual({ color: '#000000' });
  });

  it('the stack of a project is its first four technology icons by name', async () => {
    const facts = await read.facts([ref('PROJECT', studio.app.id)], ALL);
    const stack = String(facts.get(key('PROJECT', studio.app.id))?.meta.stack).split(',');
    // Alpha, Beta (no icon: its slug), Delta, Epsilon; Gamma is the fifth.
    expect(stack).toEqual(['icon-alpha', at(studio.stack, 1).slug, 'icon-delta', 'icon-epsilon']);
  });

  it('never exposes a file key, token or hash, and hides money without financials', async () => {
    const facts = await read.facts(
      [ref('CLIENT', studio.kairos.id), ref('INVOICE', studio.invoice.id)],
      {
        ...ALL,
        financials: false,
      },
    );
    expect(facts.get(key('CLIENT', studio.kairos.id))?.meta.receivableUsd).toBeNull();
    expect(facts.get(key('INVOICE', studio.invoice.id))?.meta).toMatchObject({
      total: null,
      balance: null,
    });
    const serialized = JSON.stringify([...facts.values()]);
    for (const forbidden of ['storageKey', 'bucket', 'sha256', 'token', 'hash', 'fileId']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('reports archived records as archived and skips types outside the scope', async () => {
    const facts = await read.facts(
      [ref('CONTACT', studio.archivedContact.id), ref('INVOICE', studio.invoice.id)],
      COMMERCIAL,
    );
    expect(facts.get(key('CONTACT', studio.archivedContact.id))?.archived).toBe(true);
    expect(facts.has(key('INVOICE', studio.invoice.id))).toBe(false);
    expect(queries.some((q) => q.includes('"Invoice"'))).toBe(false);
  });

  it('omits records that do not exist', async () => {
    const facts = await read.facts([ref('CLIENT', 'cli_missing')], ALL);
    expect(facts.size).toBe(0);
  });
});

describe('PrismaGraphRead.presence', () => {
  it('answers existence and archived state, with no card', async () => {
    const presence = await read.presence(
      [
        ref('CONTACT', studio.contact.id),
        ref('CONTACT', studio.archivedContact.id),
        ref('CLIENT', 'cli_missing'),
        ref('TAG', studio.tag.id),
      ],
      ALL,
    );
    expect(presence.get(key('CONTACT', studio.contact.id))).toEqual({ archived: false });
    expect(presence.get(key('CONTACT', studio.archivedContact.id))).toEqual({ archived: true });
    expect(presence.get(key('TAG', studio.tag.id))).toEqual({ archived: false });
    expect(presence.has(key('CLIENT', 'cli_missing'))).toBe(false);
  });
});

describe('PrismaGraphRead.relations', () => {
  const summary = (
    rows: { other: GraphRef; relation: string; outgoing: boolean; label?: string }[],
  ) =>
    rows
      .map(
        (r) =>
          `${r.outgoing ? '>' : '<'}${r.relation}:${r.other.type}:${r.other.id}${r.label ? `=${r.label}` : ''}`,
      )
      .sort();

  it('client: contacts (archived included), projects with role, invoices, payments, documents, notes, tags', async () => {
    const rows = must(
      (await read.relations([ref('CLIENT', studio.kairos.id)], ALL)).get(
        key('CLIENT', studio.kairos.id),
      ),
    );
    expect(summary(rows)).toEqual(
      [
        `>contacto:CONTACT:${studio.contact.id}`,
        `>contacto:CONTACT:${studio.archivedContact.id}`,
        `>participa:PROJECT:${studio.app.id}=Dueño`,
        `>participa:PROJECT:${studio.erp.id}`,
        `>facturado_a:INVOICE:${studio.invoice.id}`,
        `>pago:PAYMENT:${studio.payment.id}`,
        `<adjunto_a:DOCUMENT:${studio.document.id}`,
        `<anotado_en:NOTE:${studio.note.id}`,
        `>etiquetado:TAG:${studio.tag.id}`,
      ].sort(),
    );
  });

  it('project: clients with role, invoices through lines, expenses, documents, technologies, tags', async () => {
    const rows = must(
      (await read.relations([ref('PROJECT', studio.app.id)], ALL)).get(
        key('PROJECT', studio.app.id),
      ),
    );
    const got = summary(rows);
    expect(got).toContain(`<participa:CLIENT:${studio.kairos.id}=Dueño`);
    expect(got).toContain(`<participa:CLIENT:${studio.mochima.id}`);
    expect(got).toContain(`>incluido_en:INVOICE:${studio.invoice.id}`);
    expect(got).toContain(`<imputado_a:EXPENSE:${studio.expense.id}`);
    expect(got).toContain(`<adjunto_a:DOCUMENT:${studio.document.id}`);
    expect(got).toContain(`>etiquetado:TAG:${studio.tag.id}`);
    expect(got.filter((r) => r.includes(':TECHNOLOGY:'))).toHaveLength(5);
  });

  it('invoice and payment: allocation edges carry the amount in the invoice currency; voided ones do not exist', async () => {
    const rows = await read.relations(
      [ref('INVOICE', studio.invoice.id), ref('PAYMENT', studio.payment.id)],
      ALL,
    );
    expect(summary(must(rows.get(key('INVOICE', studio.invoice.id))))).toEqual(
      [
        `<facturado_a:CLIENT:${studio.kairos.id}`,
        `<incluido_en:PROJECT:${studio.app.id}`,
        `<paga:PAYMENT:${studio.payment.id}=116.00`,
      ].sort(),
    );
    expect(summary(must(rows.get(key('PAYMENT', studio.payment.id))))).toEqual(
      [
        `<pago:CLIENT:${studio.kairos.id}`,
        `>paga:INVOICE:${studio.invoice.id}=116.00`,
        `>acreditado_en:ACCOUNT:${studio.account.id}`,
      ].sort(),
    );
    await admin.paymentAllocation.updateMany({ data: { deletedAt: new Date() } });
    const after = await read.relations([ref('INVOICE', studio.invoice.id)], ALL);
    expect(
      summary(must(after.get(key('INVOICE', studio.invoice.id)))).some((r) => r.includes('paga')),
    ).toBe(false);
  });

  it('account, expense, document, note, technology, tag and contact', async () => {
    const rows = await read.relations(
      [
        ref('ACCOUNT', studio.account.id),
        ref('EXPENSE', studio.expense.id),
        ref('DOCUMENT', studio.document.id),
        ref('NOTE', studio.note.id),
        ref('TECHNOLOGY', at(studio.stack, 0).id),
        ref('TAG', studio.tag.id),
        ref('CONTACT', studio.contact.id),
      ],
      ALL,
    );
    expect(summary(must(rows.get(key('ACCOUNT', studio.account.id))))).toEqual(
      [
        `<acreditado_en:PAYMENT:${studio.payment.id}`,
        `<pagado_desde:EXPENSE:${studio.expense.id}`,
      ].sort(),
    );
    expect(summary(must(rows.get(key('EXPENSE', studio.expense.id))))).toEqual(
      [`>imputado_a:PROJECT:${studio.app.id}`, `>pagado_desde:ACCOUNT:${studio.account.id}`].sort(),
    );
    expect(summary(must(rows.get(key('DOCUMENT', studio.document.id))))).toEqual(
      [`>adjunto_a:CLIENT:${studio.kairos.id}`, `>adjunto_a:PROJECT:${studio.app.id}`].sort(),
    );
    expect(summary(must(rows.get(key('NOTE', studio.note.id))))).toEqual([
      `>anotado_en:CLIENT:${studio.kairos.id}`,
    ]);
    expect(summary(must(rows.get(key('TECHNOLOGY', at(studio.stack, 0).id))))).toEqual([
      `<usa:PROJECT:${studio.app.id}`,
    ]);
    expect(summary(must(rows.get(key('TAG', studio.tag.id))))).toEqual(
      [`<etiquetado:CLIENT:${studio.kairos.id}`, `<etiquetado:PROJECT:${studio.app.id}`].sort(),
    );
    expect(summary(must(rows.get(key('CONTACT', studio.contact.id))))).toEqual([
      `<contacto:CLIENT:${studio.kairos.id}`,
    ]);
  });

  it('towards types outside the scope: no rows and no query on their tables', async () => {
    const rows = must(
      (await read.relations([ref('CLIENT', studio.kairos.id)], COMMERCIAL)).get(
        key('CLIENT', studio.kairos.id),
      ),
    );
    expect(rows.some((r) => ['INVOICE', 'PAYMENT'].includes(r.other.type))).toBe(false);
    expect(
      queries.some(
        (q) => q.includes('FROM "public"."Invoice"') || q.includes('FROM "public"."Payment"'),
      ),
    ).toBe(false);
  });

  it('runs a number of queries that depends on the types, not on the nodes', async () => {
    const extra = await Promise.all(
      Array.from({ length: 30 }, async () => {
        const c = await admin.contact.create({
          data: { clientId: studio.kairos.id, fullName: 'Bulk' },
        });
        return ref('CONTACT', c.id);
      }),
    );
    queries.length = 0;
    await read.relations([ref('CONTACT', studio.contact.id)], ALL);
    const one = queries.length;
    queries.length = 0;
    await read.relations([ref('CONTACT', studio.contact.id), ...extra], ALL);
    expect(queries.length).toBe(one);
    queries.length = 0;
    await read.facts([ref('CONTACT', studio.contact.id), ...extra], ALL);
    expect(queries.length).toBeLessThanOrEqual(2);
  });
});

describe('PrismaGraphRead.listFacts', () => {
  it('lists live rows by id with tags and technologies, and archived ones only on request', async () => {
    const live = await read.listFacts('CONTACT', ALL, { includeArchived: false });
    expect(live.map((r) => r.ref.id)).toEqual([studio.contact.id]);
    const all = await read.listFacts('CONTACT', ALL, { includeArchived: true });
    expect(all.map((r) => r.ref.id).sort()).toEqual(
      [studio.contact.id, studio.archivedContact.id].sort(),
    );

    const projects = await read.listFacts('PROJECT', ALL, { includeArchived: false });
    const app = must(projects.find((r) => r.ref.id === studio.app.id));
    expect(app.facts.tagIds).toEqual([studio.tag.id]);
    expect(app.facts.technologyIds).toHaveLength(5);
    expect(app.facts.date).toBe('2026-07-05');
    const clients = await read.listFacts('CLIENT', ALL, { includeArchived: false });
    expect(clients.map((r) => r.ref.id)).toEqual([studio.kairos.id, studio.mochima.id].sort());
    expect(clients.find((r) => r.ref.id === studio.mochima.id)?.facts.tagIds).toEqual([]);
    const accounts = await read.listFacts('ACCOUNT', ALL, { includeArchived: false });
    expect(accounts[0]?.facts.tagIds).toBeNull();
  });

  it('returns nothing for a type outside the scope', async () => {
    expect(await read.listFacts('INVOICE', COMMERCIAL, { includeArchived: true })).toEqual([]);
  });
});
