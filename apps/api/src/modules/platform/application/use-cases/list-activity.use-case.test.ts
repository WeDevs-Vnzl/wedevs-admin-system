import { describe, expect, it } from 'vitest';
import { FakeAuthorization } from '../../../../../test/support/fakes/fake-authorization';
import { InMemoryActivityRead } from '../../../../../test/activity/fakes/in-memory-activity-read';
import type { CurrentUser } from '../../../../shared/application/current-user';
import { BUSINESS_TIME_ZONE, toDateOnly } from '../../../../shared/domain/business-date';
import { DEFAULT_LIST_QUERY, type ListQuery } from '../../../../shared/domain/list-query';
import type { ActivityRecord } from '../ports/activity-read.port';
import { ListActivity, caracasDayStart } from './list-activity.use-case';

const owner: CurrentUser = {
  userId: 'usr_owner',
  clerkId: 'clerk_owner',
  role: 'OWNER',
  email: 'owner@example.test',
  name: 'Owner',
};
const admin: CurrentUser = { ...owner, userId: 'usr_admin', role: 'ADMIN' };
const member: CurrentUser = { ...owner, userId: 'usr_member', role: 'MEMBER' };
const viewer: CurrentUser = { ...owner, userId: 'usr_viewer', role: 'VIEWER' };

// Mirrors the matrix for `activity`: read for Owner and Admin only (PRD §4.3, DT-66).
const activityReadPolicy = new FakeAuthorization({
  policy: (user, action, resource) =>
    resource === 'activity' && action === 'read' && ['OWNER', 'ADMIN'].includes(user.role),
});

const BASE_TIME = Date.parse('2026-10-01T12:00:00.000Z');

function row(n: number, over: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    id: `act_${String(n).padStart(4, '0')}`,
    actorType: 'USER',
    actorId: 'usr_ana',
    actorName: 'Ana Torres',
    actorImageUrl: null,
    action: 'UPDATE',
    entityType: 'CLIENT',
    entityId: 'cli_kairos',
    entityLabel: 'Kairos Studio',
    changes: { phone: ['+584125550001', '+584125550002'] },
    metadata: null,
    ip: '192.0.2.14',
    userAgent: 'Mozilla/5.0',
    createdAt: new Date(BASE_TIME + n * 60_000),
    ...over,
  };
}

function query(over: Partial<ListQuery> = {}): ListQuery {
  return { ...DEFAULT_LIST_QUERY, pageSize: 100, ...over };
}

function setup(rows: ActivityRecord[] = []) {
  const port = new InMemoryActivityRead();
  port.rows.push(...rows);
  return { port, useCase: new ListActivity(activityReadPolicy, port) };
}

describe('ListActivity: authorization', () => {
  it('lets Owner and Admin read and refuses Member and Viewer without touching the port', async () => {
    const { port, useCase } = setup([row(1)]);
    await expect(useCase.execute(owner, query())).resolves.toMatchObject({ total: 1 });
    await expect(useCase.execute(admin, query())).resolves.toMatchObject({ total: 1 });
    await expect(useCase.execute(member, query())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(useCase.execute(viewer, query())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(port.calls).toBe(2);
  });
});

describe('ListActivity: listing', () => {
  it('returns entries newest first with the page envelope and an id tie-breaker', async () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      row(i + 1, { createdAt: new Date(BASE_TIME) }),
    );
    const { useCase } = setup(rows);
    const result = await useCase.execute(owner, query({ pageSize: 25, page: 1 }));
    expect(result.total).toBe(30);
    expect(result.items).toHaveLength(25);
    expect(result.pageCount).toBe(2);
    expect(result.items.map((item) => item.id).slice(0, 2)).toEqual(['act_0001', 'act_0002']);
    const times = result.items.map((item) => item.createdAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('sorts by an allowed field and rejects any other', async () => {
    const { port, useCase } = setup([row(1), row(2)]);
    await useCase.execute(owner, query({ sort: { field: 'action', direction: 'asc' } }));
    expect(port.lastCriteria?.sort).toEqual({ field: 'action', direction: 'asc' });
    await expect(
      useCase.execute(owner, query({ sort: { field: 'ip', direction: 'asc' } })),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { sort: ['validation.sort.invalid'] },
    });
  });

  it('filters by actor type, action and entity type, each facet ORed inside itself', async () => {
    const { useCase } = setup([
      row(1, { actorType: 'SYSTEM', actorId: null, actorName: null, action: 'SYSTEM_JOB' }),
      row(2, { action: 'STATUS_CHANGE', entityType: 'PROJECT' }),
      row(3, { action: 'CREATE' }),
      row(4, { action: 'UPDATE', entityType: 'PROJECT' }),
    ]);
    const system = await useCase.execute(owner, query({ filters: { actorType: 'SYSTEM' } }));
    expect(system.items.map((item) => item.actor.type)).toEqual(['SYSTEM']);

    const updates = await useCase.execute(
      owner,
      query({ filters: { action: ['UPDATE', 'STATUS_CHANGE'] } }),
    );
    expect(updates.items.every((item) => ['UPDATE', 'STATUS_CHANGE'].includes(item.action))).toBe(
      true,
    );
    expect(updates.total).toBe(2);

    const clients = await useCase.execute(owner, query({ filters: { entityType: 'CLIENT' } }));
    expect(clients.items.every((item) => item.entityType === 'CLIENT')).toBe(true);
  });

  it("filters one record's timeline by entity type and id", async () => {
    const { useCase } = setup([
      row(1),
      row(2, { entityId: 'cli_other' }),
      row(3, { entityType: 'PROJECT', entityId: 'cli_kairos' }),
    ]);
    const timeline = await useCase.execute(
      owner,
      query({ filters: { entityType: 'CLIENT', entityId: 'cli_kairos' } }),
    );
    expect(timeline.items.map((item) => item.id)).toEqual(['act_0001']);
  });

  it('filters by actor id', async () => {
    const { useCase } = setup([row(1), row(2, { actorId: 'usr_luis', actorName: 'Luis' })]);
    const result = await useCase.execute(owner, query({ filters: { actorId: 'usr_luis' } }));
    expect(result.items.map((item) => item.actor.id)).toEqual(['usr_luis']);
  });

  it('bounds from and to by Caracas calendar days, both inclusive', async () => {
    // 02:30 UTC on 2026-10-08 is still 2026-10-07 in Caracas (UTC-4): the day boundary is Caracas, not UTC.
    const probe = row(1, { createdAt: new Date('2026-10-08T02:30:00.000Z') });
    const { useCase } = setup([probe]);
    const day = await useCase.execute(
      owner,
      query({ filters: { from: '2026-10-07', to: '2026-10-07' } }),
    );
    expect(day.items.map((item) => item.id)).toEqual(['act_0001']);
    const nextDay = await useCase.execute(
      owner,
      query({ filters: { from: '2026-10-08', to: '2026-10-08' } }),
    );
    expect(nextDay.items).toEqual([]);
  });

  it('returns an empty page for an unmatched filter', async () => {
    const { useCase } = setup([row(1)]);
    const none = await useCase.execute(
      owner,
      query({ filters: { entityType: 'TAG', entityId: 'tag_missing_probe' } }),
    );
    expect(none).toMatchObject({ items: [], total: 0, pageCount: 1 });
  });

  it('searches the entity label and the actor name, accent-insensitively', async () => {
    const { port, useCase } = setup([
      row(1, { entityLabel: 'Cotización 0001' }),
      row(2, { entityLabel: 'Kairos Studio', actorName: 'Andrés Molina' }),
      row(3, { entityLabel: 'Otro', actorName: 'Luis' }),
    ]);
    const byLabel = await useCase.execute(owner, query({ q: 'cotizacion' }));
    expect(byLabel.items.map((item) => item.id)).toEqual(['act_0001']);
    const byActor = await useCase.execute(owner, query({ q: 'andres' }));
    expect(byActor.items.map((item) => item.id)).toEqual(['act_0002']);
    expect(port.lastCriteria?.search).toBe('andres');
  });
});

describe('ListActivity: validation of the filters', () => {
  it('needs exactly one entity type next to an entity id', async () => {
    const { useCase } = setup([row(1)]);
    await expect(
      useCase.execute(owner, query({ filters: { entityId: 'cli_kairos' } })),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { entityType: ['validation.required'] },
    });
    await expect(
      useCase.execute(
        owner,
        query({ filters: { entityType: ['CLIENT', 'PROJECT'], entityId: 'cli_kairos' } }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects a reversed range, a malformed day and a repeated single-value filter', async () => {
    const { useCase } = setup([row(1)]);
    await expect(
      useCase.execute(owner, query({ filters: { from: '2026-10-10', to: '2026-10-01' } })),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { to: ['validation.date.invalid'] },
    });
    await expect(
      useCase.execute(owner, query({ filters: { from: '2026-13-01' } })),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { from: ['validation.date.invalid'] },
    });
    await expect(
      useCase.execute(owner, query({ filters: { from: ['2026-10-01', '2026-10-02'] } })),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { from: ['validation.invalidFormat'] },
    });
  });
});

describe('ListActivity: output rows', () => {
  it('masks the IP of every row and never returns the raw address', async () => {
    const { useCase } = setup([
      row(1, { ip: '192.0.2.14' }),
      row(2, { ip: '2001:db8:85a3:0:0:8a2e:370:7334' }),
      row(3, { ip: null }),
    ]);
    const result = await useCase.execute(owner, query());
    // Newest first: row 3 (no IP), row 2 (IPv6), row 1 (IPv4).
    expect(result.items.map((item) => item.ip)).toEqual([null, '2001:db8:85a3:•••', '192.0.2.•••']);
    expect(JSON.stringify(result)).not.toContain('192.0.2.14');
    expect(JSON.stringify(result)).not.toContain('370:7334');
  });

  it('shows no actor name for SYSTEM and PUBLIC rows and keeps stored changes as written', async () => {
    const { useCase } = setup([
      row(1, {
        actorType: 'SYSTEM',
        actorId: null,
        actorName: null,
        ip: null,
        userAgent: null,
        changes: { status: ['EMITIDA', 'PAGADA'], description: 'changed' },
      }),
    ]);
    const [item] = (await useCase.execute(owner, query())).items;
    expect(item?.actor).toEqual({ type: 'SYSTEM', id: null, name: null, imageUrl: null });
    expect(item?.changes).toEqual({ status: ['EMITIDA', 'PAGADA'], description: 'changed' });
  });
});

describe('caracasDayStart', () => {
  it('is the instant the Caracas zone reads as midnight of that calendar day', () => {
    const start = caracasDayStart('2026-10-08');
    expect(start.toISOString()).toBe('2026-10-08T04:00:00.000Z');
    expect(toDateOnly(start, BUSINESS_TIME_ZONE)).toBe('2026-10-08');
    expect(toDateOnly(new Date(start.getTime() - 1), BUSINESS_TIME_ZONE)).toBe('2026-10-07');
  });
});
