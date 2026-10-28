import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { caracasDayStart } from '../application/use-cases/list-activity.use-case';
import type { ActivityListCriteria } from '../application/ports/activity-read.port';
import { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { PrismaActivityReadAdapter } from './prisma-activity-read.adapter';

// Seeding through Prisma on a shared local box is slow; the suite gets the same budget as the e2e files.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const host = new TransactionHost(service);
const reader = new PrismaActivityReadAdapter(host);

const criteria = (over: Partial<ActivityListCriteria> = {}): ActivityListCriteria => ({
  page: 1,
  pageSize: 100,
  sort: { field: 'createdAt', direction: 'desc' },
  search: null,
  actorIds: [],
  actorTypes: [],
  actions: [],
  entityTypes: [],
  entityId: null,
  createdFrom: null,
  createdBefore: null,
  ...over,
});

let seq = 0;
async function entry(over: {
  createdAt: string;
  actorId?: string | null;
  actorType?: 'USER' | 'SYSTEM' | 'PUBLIC';
  action?: 'UPDATE' | 'CREATE' | 'STATUS_CHANGE' | 'SYSTEM_JOB';
  entityType?: 'CLIENT' | 'PROJECT' | 'INVOICE';
  entityId?: string;
  entityLabel?: string;
  ip?: string | null;
  changes?: Prisma.InputJsonObject;
}): Promise<void> {
  seq += 1;
  await admin.activityLog.create({
    data: {
      id: `act_int_${String(seq).padStart(4, '0')}`,
      actorType: over.actorType ?? 'USER',
      actorId: over.actorId === undefined ? 'usr_int_ana' : over.actorId,
      action: over.action ?? 'UPDATE',
      entityType: over.entityType ?? 'CLIENT',
      entityId: over.entityId ?? 'cli_kairos',
      entityLabel: over.entityLabel ?? 'Kairos Studio',
      changes: over.changes ?? { phone: ['a', 'b'] },
      ip: over.ip === undefined ? '192.0.2.14' : over.ip,
      userAgent: 'Mozilla/5.0',
      createdAt: new Date(over.createdAt),
    },
  });
}

beforeAll(async () => {
  await truncateBusinessTables(admin);
}, 60_000);

beforeEach(async () => {
  seq = 0;
  await admin.activityLog.deleteMany();
  await admin.user.deleteMany();
  await admin.user.create({
    data: {
      id: 'usr_int_ana',
      clerkId: 'clerk_int_ana',
      email: 'ana@example.test',
      name: 'Andrés Molina',
      imageUrl: 'https://img.example.test/ana.png',
      role: 'OWNER',
    },
  });
  await admin.user.create({
    data: {
      id: 'usr_int_luis',
      clerkId: 'clerk_int_luis',
      email: 'luis@example.test',
      name: 'Luis Ruiz',
      role: 'ADMIN',
    },
  });
});

afterAll(async () => {
  await admin.activityLog.deleteMany();
  await admin.user.deleteMany();
  await service.client.$disconnect();
  await admin.$disconnect();
});

describe('PrismaActivityReadAdapter (int)', () => {
  it('lists newest first with an id tie-breaker and the page envelope', async () => {
    await entry({ createdAt: '2026-10-09T10:00:00.000Z' });
    await entry({ createdAt: '2026-10-09T12:00:00.000Z' });
    await entry({ createdAt: '2026-10-09T12:00:00.000Z' });
    await entry({ createdAt: '2026-10-08T09:00:00.000Z' });

    const all = await reader.list(criteria());
    expect(all.total).toBe(4);
    expect(all.pageCount).toBe(1);
    const times = all.items.map((item) => item.createdAt.toISOString());
    expect(times).toEqual([
      '2026-10-09T12:00:00.000Z',
      '2026-10-09T12:00:00.000Z',
      '2026-10-09T10:00:00.000Z',
      '2026-10-08T09:00:00.000Z',
    ]);
    const [newer, older] = all.items;
    expect((newer?.id ?? '') < (older?.id ?? '')).toBe(true);

    const beyond = await reader.list(criteria({ pageSize: 25, page: 2 }));
    expect(beyond.items).toEqual([]);
    expect(beyond.total).toBe(4);
  });

  it('pages with total and pageCount, and the pages do not overlap', async () => {
    await admin.activityLog.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({
        id: `act_int_page_${String(i).padStart(2, '0')}`,
        actorType: 'USER' as const,
        actorId: 'usr_int_ana',
        action: 'UPDATE' as const,
        entityType: 'CLIENT' as const,
        entityId: 'cli_kairos',
        entityLabel: 'Kairos Studio',
        createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)),
      })),
    });
    const first = await reader.list(criteria({ pageSize: 25, page: 1 }));
    const second = await reader.list(criteria({ pageSize: 25, page: 2 }));
    expect(first.items).toHaveLength(25);
    expect(second.items).toHaveLength(5);
    expect(first.total).toBe(30);
    expect(second.pageCount).toBe(2);
    expect(second.page).toBe(2);
    expect(first.items.map((i) => i.id)).not.toContain(second.items[0]?.id);
  });

  it('joins the actor name and image and leaves SYSTEM rows without a user', async () => {
    await entry({ createdAt: '2026-10-09T10:00:00.000Z' });
    await entry({
      createdAt: '2026-10-09T11:00:00.000Z',
      actorType: 'SYSTEM',
      actorId: null,
      action: 'SYSTEM_JOB',
    });
    const page = await reader.list(criteria());
    const system = page.items.find((item) => item.actorType === 'SYSTEM');
    expect(system).toMatchObject({ actorId: null, actorName: null, actorImageUrl: null });
    const user = page.items.find((item) => item.actorType === 'USER');
    expect(user).toMatchObject({
      actorId: 'usr_int_ana',
      actorName: 'Andrés Molina',
      actorImageUrl: 'https://img.example.test/ana.png',
    });
  });

  it('returns the stored IP and changes as written; masking is the use case rule', async () => {
    await entry({
      createdAt: '2026-10-09T10:00:00.000Z',
      ip: '192.0.2.14',
      changes: { status: ['PROSPECTO', 'ACTIVO'], description: 'changed' },
    });
    const [item] = (await reader.list(criteria())).items;
    expect(item?.ip).toBe('192.0.2.14');
    expect(item?.changes).toEqual({ status: ['PROSPECTO', 'ACTIVO'], description: 'changed' });
  });

  it('filters by actor type, action and entity type, each facet ORed inside itself', async () => {
    await entry({
      createdAt: '2026-10-09T10:00:00.000Z',
      actorType: 'SYSTEM',
      actorId: null,
      action: 'SYSTEM_JOB',
    });
    await entry({
      createdAt: '2026-10-09T11:00:00.000Z',
      action: 'STATUS_CHANGE',
      entityType: 'PROJECT',
    });
    await entry({ createdAt: '2026-10-09T12:00:00.000Z', action: 'CREATE' });
    await entry({ createdAt: '2026-10-09T13:00:00.000Z', action: 'UPDATE', entityType: 'PROJECT' });

    const system = await reader.list(criteria({ actorTypes: ['SYSTEM'] }));
    expect(system.items.map((item) => item.actorType)).toEqual(['SYSTEM']);

    const updates = await reader.list(criteria({ actions: ['UPDATE', 'STATUS_CHANGE'] }));
    expect(updates.total).toBe(2);
    expect(updates.items.every((item) => ['UPDATE', 'STATUS_CHANGE'].includes(item.action))).toBe(
      true,
    );

    const clientsAndProjects = await reader.list(criteria({ entityTypes: ['CLIENT', 'PROJECT'] }));
    expect(clientsAndProjects.total).toBe(4);
  });

  it("filters one record's timeline by entity type and id, and by actor id", async () => {
    await entry({ createdAt: '2026-10-09T10:00:00.000Z', entityId: 'cli_kairos' });
    await entry({ createdAt: '2026-10-09T11:00:00.000Z', entityId: 'cli_other' });
    await entry({
      createdAt: '2026-10-09T12:00:00.000Z',
      entityType: 'PROJECT',
      entityId: 'cli_kairos',
    });
    await entry({ createdAt: '2026-10-09T13:00:00.000Z', actorId: 'usr_int_luis' });

    const timeline = await reader.list(
      criteria({ entityTypes: ['CLIENT'], entityId: 'cli_kairos' }),
    );
    // Row 4 carries the same CLIENT id (only its actor differs), so it belongs to the timeline too.
    expect(timeline.items.map((item) => item.id)).toEqual(['act_int_0004', 'act_int_0001']);

    const byActor = await reader.list(criteria({ actorIds: ['usr_int_luis'] }));
    expect(byActor.items.map((item) => item.actorId)).toEqual(['usr_int_luis']);
  });

  it('bounds the day filter by the Caracas calendar day, both inclusive, at 03:59 and 04:00 UTC', async () => {
    await entry({ createdAt: '2026-10-08T03:59:59.999Z', entityLabel: 'before-midnight' });
    await entry({ createdAt: '2026-10-08T04:00:00.000Z', entityLabel: 'at-midnight' });

    const day7 = await reader.list(
      criteria({
        createdFrom: caracasDayStart('2026-10-07'),
        createdBefore: caracasDayStart('2026-10-08'),
      }),
    );
    expect(day7.items.map((item) => item.entityLabel)).toEqual(['before-midnight']);

    const day8 = await reader.list(
      criteria({
        createdFrom: caracasDayStart('2026-10-08'),
        createdBefore: caracasDayStart('2026-10-09'),
      }),
    );
    expect(day8.items.map((item) => item.entityLabel)).toEqual(['at-midnight']);
  });

  it('searches the entity label and the actor name, accent-insensitively and with LIKE characters literal', async () => {
    await entry({ createdAt: '2026-10-09T10:00:00.000Z', entityLabel: 'Cotización 0001' });
    await entry({
      createdAt: '2026-10-09T11:00:00.000Z',
      entityLabel: 'Kairos',
      actorId: 'usr_int_luis',
    });
    await entry({ createdAt: '2026-10-09T12:00:00.000Z', entityLabel: 'Cuota 100% lleno' });
    await entry({ createdAt: '2026-10-09T13:00:00.000Z', entityLabel: 'Cuota 1000 libre' });

    const byLabel = await reader.list(criteria({ search: 'cotizacion' }));
    expect(byLabel.items.map((item) => item.entityLabel)).toEqual(['Cotización 0001']);

    // Three rows were written by Ana; Luis's row must not match.
    const byActor = await reader.list(criteria({ search: 'ANDRES' }));
    expect(byActor.items.map((item) => item.actorName)).toEqual([
      'Andrés Molina',
      'Andrés Molina',
      'Andrés Molina',
    ]);
    expect(byActor.items.map((item) => item.actorId)).not.toContain('usr_int_luis');

    const literal = await reader.list(criteria({ search: '100%' }));
    expect(literal.items.map((item) => item.entityLabel)).toEqual(['Cuota 100% lleno']);
  });

  it('sorts by an allowed field, the id tie-breaker keeping pages stable', async () => {
    await entry({ createdAt: '2026-10-09T10:00:00.000Z', action: 'UPDATE', entityType: 'PROJECT' });
    await entry({ createdAt: '2026-10-09T11:00:00.000Z', action: 'CREATE', entityType: 'INVOICE' });
    await entry({
      createdAt: '2026-10-09T12:00:00.000Z',
      action: 'STATUS_CHANGE',
      entityType: 'CLIENT',
    });

    const byAction = await reader.list(criteria({ sort: { field: 'action', direction: 'asc' } }));
    expect(byAction.items.map((item) => item.action)).toEqual([
      'CREATE',
      'STATUS_CHANGE',
      'UPDATE',
    ]);

    const byType = await reader.list(
      criteria({ sort: { field: 'entityType', direction: 'desc' } }),
    );
    expect(byType.items.map((item) => item.entityType)).toEqual(['PROJECT', 'INVOICE', 'CLIENT']);
  });

  it('returns an empty page with pageCount 1 for an unmatched filter', async () => {
    await entry({ createdAt: '2026-10-09T10:00:00.000Z' });
    const none = await reader.list(
      criteria({ entityTypes: ['CLIENT'], entityId: 'tag_missing_probe' }),
    );
    expect(none).toEqual({ items: [], total: 0, page: 1, pageSize: 100, pageCount: 1 });
  });
});
