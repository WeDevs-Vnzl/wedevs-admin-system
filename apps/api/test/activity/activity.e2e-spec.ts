import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixAuthorization } from '../../src/modules/identity/application/matrix-authorization';
import { ActivityModule } from '../../src/modules/platform/activity.module';
import { AUTHORIZATION } from '../../src/shared/application/ports/tokens';
import { createTestPrisma, truncateBusinessTables } from '../support/db';
import { FakeAuthenticator } from '../support/fakes/fake-authenticator';
import { createTestApp } from '../support/test-app';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

describe('activity listing (e2e)', () => {
  const prisma = createTestPrisma();
  const authenticator = new FakeAuthenticator();
  let app: NestExpressApplication;
  const tokens: Record<'owner' | 'admin' | 'member' | 'viewer', string> = {
    owner: '',
    admin: '',
    member: '',
    viewer: '',
  };

  const http = () => request(app.getHttpServer());
  const as = (role: keyof typeof tokens) => `Bearer ${tokens[role]}`;

  beforeAll(async () => {
    // The real permission matrix (PRD §4.3) decides; only the identity edge is faked.
    app = await createTestApp({
      modules: [ActivityModule],
      authenticator,
      overrides: [{ token: AUTHORIZATION, useValue: new MatrixAuthorization() }],
    });
  });

  beforeEach(async () => {
    await truncateBusinessTables(prisma);
    const users = [
      ['owner', 'OWNER'],
      ['admin', 'ADMIN'],
      ['member', 'MEMBER'],
      ['viewer', 'VIEWER'],
    ] as const;
    for (const [tag, role] of users) {
      const row = await prisma.user.create({
        data: { clerkId: `clerk_${tag}`, email: `${tag}@example.test`, name: `User ${tag}`, role },
      });
      tokens[tag] = authenticator.issue({
        userId: row.id,
        clerkId: row.clerkId,
        role,
        email: row.email,
        name: row.name,
      });
    }
    const owner = await prisma.user.findUniqueOrThrow({ where: { clerkId: 'clerk_owner' } });
    await prisma.activityLog.createMany({
      data: [
        {
          id: 'act_e2e_old',
          actorType: 'USER',
          actorId: owner.id,
          action: 'UPDATE',
          entityType: 'CLIENT',
          entityId: 'cli_kairos',
          entityLabel: 'Kairos Studio',
          changes: { phone: ['+584125550001', '+584125550002'] },
          ip: '192.0.2.14',
          userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/120.0',
          createdAt: new Date('2026-10-08T15:00:00.000Z'),
        },
        {
          id: 'act_e2e_new',
          actorType: 'SYSTEM',
          actorId: null,
          action: 'SYSTEM_JOB',
          entityType: 'INVOICE',
          entityId: 'inv_0001',
          entityLabel: 'FAC-0001',
          createdAt: new Date('2026-10-09T15:00:00.000Z'),
        },
      ],
    });
  });

  afterAll(async () => {
    await truncateBusinessTables(prisma);
    await prisma.$disconnect();
    await app.close();
  });

  it('answers the Owner a page, newest first, with the IP masked and the raw address absent', async () => {
    const res = await http().get('/api/v1/activity').set('Authorization', as('owner')).expect(200);
    expect(res.body).toMatchObject({ total: 2, page: 1, pageSize: 25, pageCount: 1 });
    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual([
      'act_e2e_new',
      'act_e2e_old',
    ]);
    const old = res.body.items[1];
    expect(old).toMatchObject({
      action: 'UPDATE',
      entityType: 'CLIENT',
      entityId: 'cli_kairos',
      entityLabel: 'Kairos Studio',
      changes: { phone: ['+584125550001', '+584125550002'] },
      metadata: null,
      ip: '192.0.2.•••',
    });
    expect(old.actor).toMatchObject({ type: 'USER', name: 'User owner' });
    expect(res.body.items[0].actor).toEqual({
      type: 'SYSTEM',
      id: null,
      name: null,
      imageUrl: null,
    });
    expect(JSON.stringify(res.body)).not.toContain('192.0.2.14');
  });

  it('answers the Admin the same page', async () => {
    const res = await http().get('/api/v1/activity').set('Authorization', as('admin')).expect(200);
    expect(res.body.total).toBe(2);
  });

  it('refuses Member and Viewer with FORBIDDEN', async () => {
    for (const role of ['member', 'viewer'] as const) {
      const res = await http().get('/api/v1/activity').set('Authorization', as(role)).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('refuses an anonymous request', async () => {
    await http().get('/api/v1/activity').expect(401);
  });

  it("filters one record's timeline and the day range (Caracas days, inclusive)", async () => {
    const timeline = await http()
      .get('/api/v1/activity?entityType=CLIENT&entityId=cli_kairos')
      .set('Authorization', as('owner'))
      .expect(200);
    expect(timeline.body.items.map((item: { id: string }) => item.id)).toEqual(['act_e2e_old']);

    const day = await http()
      .get('/api/v1/activity?from=2026-10-09&to=2026-10-09')
      .set('Authorization', as('owner'))
      .expect(200);
    expect(day.body.items.map((item: { id: string }) => item.id)).toEqual(['act_e2e_new']);
  });

  it('answers 422 for a timeline without exactly one entity type', async () => {
    const res = await http()
      .get('/api/v1/activity?entityId=cli_kairos')
      .set('Authorization', as('owner'))
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.fieldErrors).toEqual({ entityType: ['validation.required'] });
  });

  it('answers 422 for a sort outside the whitelist, an unknown filter value and a reversed range', async () => {
    const sort = await http()
      .get('/api/v1/activity?sort=ip:asc')
      .set('Authorization', as('owner'))
      .expect(422);
    expect(sort.body.error.fieldErrors).toEqual({ sort: ['validation.sort.invalid'] });

    const actor = await http()
      .get('/api/v1/activity?actorType=BOT')
      .set('Authorization', as('owner'))
      .expect(422);
    expect(actor.body.error.code).toBe('VALIDATION');

    const range = await http()
      .get('/api/v1/activity?from=2026-10-10&to=2026-10-01')
      .set('Authorization', as('owner'))
      .expect(422);
    expect(range.body.error.fieldErrors).toEqual({ to: ['validation.date.invalid'] });
  });

  it('has no route to change or remove an entry (append-only, C20)', async () => {
    await http()
      .patch('/api/v1/activity/act_e2e_old')
      .set('Authorization', as('owner'))
      .send({ action: 'CREATE' })
      .expect(404);
    await http()
      .delete('/api/v1/activity/act_e2e_old')
      .set('Authorization', as('owner'))
      .expect(404);
    expect(await prisma.activityLog.count()).toBe(2);
  });
});
