import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { PrismaNoteTargetAdapter } from './prisma-note-target.adapter';

const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const adapter = new PrismaNoteTargetAdapter(new TransactionHost(service));

let clientId = '';
let archivedClientId = '';
let contactId = '';
let projectId = '';
let archivedProjectId = '';

beforeAll(() => {
  assertLocalDatabaseUrl(process.env.DATABASE_URL);
});
beforeEach(async () => {
  await truncateBusinessTables(admin);
  const client = (code: string, tradeName: string, deletedAt: Date | null) =>
    admin.client.create({
      data: {
        code,
        kind: 'EMPRESA',
        tradeName,
        legalName: `${tradeName} SA`,
        taxId: code,
        country: 'VE',
        address: 'x',
        phone: '1',
        deletedAt,
      },
    });
  clientId = (await client('CLI-0001', 'Kairos', null)).id;
  archivedClientId = (await client('CLI-0002', 'Viejo', new Date())).id;
  contactId = (await admin.contact.create({ data: { clientId, fullName: 'Ana' } })).id;
  projectId = (
    await admin.project.create({ data: { code: 'PRY-0001', name: 'Web', summary: 's' } })
  ).id;
  archivedProjectId = (
    await admin.project.create({
      data: { code: 'PRY-0002', name: 'Viejo', summary: 's', deletedAt: new Date() },
    })
  ).id;
});
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

describe('PrismaNoteTargetAdapter (int)', { timeout: 120_000 }, () => {
  it('resolves live clients, contacts and projects with their references', async () => {
    const found = await adapter.resolve([
      { entityType: 'CLIENT', entityId: clientId },
      { entityType: 'CONTACT', entityId: contactId },
      { entityType: 'PROJECT', entityId: projectId },
    ]);
    expect(found.get(`CLIENT:${clientId}`)).toEqual({
      ref: { type: 'CLIENT', id: clientId, code: 'CLI-0001', label: 'Kairos' },
      archived: false,
    });
    expect(found.get(`CONTACT:${contactId}`)).toEqual({
      ref: { type: 'CONTACT', id: contactId, label: 'Ana' },
      archived: false,
    });
    expect(found.get(`PROJECT:${projectId}`)).toEqual({
      ref: { type: 'PROJECT', id: projectId, code: 'PRY-0001', label: 'Web' },
      archived: false,
    });
  });

  it('flags archived rows instead of hiding them, and leaves unknown ids out', async () => {
    const found = await adapter.resolve([
      { entityType: 'CLIENT', entityId: archivedClientId },
      { entityType: 'PROJECT', entityId: archivedProjectId },
      { entityType: 'CLIENT', entityId: 'cli_missing' },
    ]);
    expect(found.get(`CLIENT:${archivedClientId}`)?.archived).toBe(true);
    expect(found.get(`PROJECT:${archivedProjectId}`)?.archived).toBe(true);
    expect(found.has('CLIENT:cli_missing')).toBe(false);
  });

  it('does not query anything for an empty target list', async () => {
    await expect(adapter.resolve([])).resolves.toEqual(new Map());
  });
});
