import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedClient, seedInvoice } from '../../../../test/finance/read-models/world';
import { buildInvoiceWorld } from '../../../../test/finance/invoices/int-world';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { FinanceInvoiceForLink } from './finance-invoice-for-link.adapter';

const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const world = buildInvoiceWorld(service);
const adapter = new FinanceInvoiceForLink(world.support);

beforeAll(async () => {
  await truncateBusinessTables(admin);
  await world.uow.run(async () => {
    await seedClient(world.host.db, 'cli_a');
    const specs = [
      ['inv_emitida', 'EMITIDA', false],
      ['inv_parcial', 'PARCIAL', false],
      ['inv_vencida', 'VENCIDA', false],
      ['inv_pagada', 'PAGADA', false],
      ['inv_borrador', 'BORRADOR', false],
      ['inv_anulada', 'ANULADA', false],
      ['inv_archivada', 'EMITIDA', true],
    ] as const;
    for (const [id, status, archived] of specs) {
      await seedInvoice(world.host.db, {
        id,
        clientId: 'cli_a',
        status,
        archived,
        currency: 'EUR',
        lines: [{ id: `${id}_l`, projectId: null, unitPrice: '100.00', ivaRate: null }],
      });
    }
  });
}, 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

describe('FinanceInvoiceForLink', () => {
  it('maps number, client, currency and the open balance as a decimal string', async () => {
    expect(await adapter.load('inv_emitida')).toEqual({
      id: 'inv_emitida',
      number: 'N-inv_emitida',
      clientId: 'cli_a',
      currency: 'EUR',
      openBalance: '100.00',
      open: true,
    });
  });

  it.each([
    ['inv_emitida', true],
    ['inv_parcial', true],
    ['inv_vencida', true],
    ['inv_pagada', false],
    ['inv_borrador', false],
    ['inv_anulada', false],
    ['inv_archivada', false],
  ])('%s is open: %s', async (id, open) => {
    expect((await adapter.load(id)).open).toBe(open);
  });

  it('throws NOT_FOUND for an unknown invoice', async () => {
    await expect(adapter.load('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
