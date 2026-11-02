import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import { ExportsModule } from '../../../src/modules/intelligence/exports.module';
import { ActivityModule } from '../../../src/modules/platform/activity.module';
import { TagsModule } from '../../../src/modules/settings/tags.module';
import { TechnologiesModule } from '../../../src/modules/settings/technologies.module';
import { ExportSourceRegistry } from '../../../src/shared/application/ports/export-source.port';
import { AUTHORIZATION } from '../../../src/shared/application/ports/tokens';
import type { UserRole } from '../../../src/shared/domain/enums';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';
import { createTestApp } from '../../support/test-app';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const URL = '/api/v1/exports';
const BOM = '﻿';

/**
 * The tag, technology and activity tables as CSV export sources (DT-171). Each source reads through the
 * table's own list use case, so the list's grant decides: tags and technologies are reference reads for
 * every signed-in role (DT-71), the activity log is Owner and Admin only (PRD §4.3, DT-66).
 */
describe('POST /exports for the tag, technology and activity tables (e2e)', () => {
  const prisma = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));
  const authenticator = new FakeAuthenticator();
  const tokens = {} as Record<UserRole, string>;
  let app: NestExpressApplication;

  const raw = (res: request.Response): string => (res.body as Buffer).toString('utf8');
  const exportCsv = (role: UserRole | null, entity: string, payload: unknown) => {
    const req = request(app.getHttpServer()).post(`${URL}/${entity}`);
    return (role ? req.set('Authorization', `Bearer ${tokens[role]}`) : req)
      .send(payload as object)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
  };
  const columns = (...ids: string[]) => ids.map((id) => ({ id, label: `L-${id}` }));

  beforeAll(async () => {
    app = await createTestApp({
      modules: [ExportsModule, TagsModule, TechnologiesModule, ActivityModule],
      authenticator,
      overrides: [{ token: AUTHORIZATION, useValue: new MatrixAuthorization() }],
    });
  });

  afterAll(async () => {
    await truncateBusinessTables(prisma);
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await truncateBusinessTables(prisma);
    await prisma.technology.deleteMany({ where: { slug: 'elixir-e2e' } });
    for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const) {
      const row = await prisma.user.create({
        data: {
          clerkId: `clerk_catexp_${role}`,
          email: `catexp-${role.toLowerCase()}@example.test`,
          name: role,
          role,
        },
      });
      tokens[role] = authenticator.issue({
        userId: row.id,
        clerkId: row.clerkId,
        role,
        email: row.email,
        name: row.name,
      });
    }
  });

  it('registers the three sources under their upper-case tokens', () => {
    expect(app.get(ExportSourceRegistry).entities()).toEqual(
      expect.arrayContaining(['TAG', 'TECHNOLOGY', 'ACTIVITY']),
    );
  });

  describe('TAG', () => {
    beforeEach(async () => {
      await prisma.tag.create({
        data: { id: 'tag_e2e', name: 'Prioritario-e2e', color: '#112233' },
      });
    });

    it('writes one row with the table columns and logs the export', async () => {
      const res = await exportCsv('OWNER', 'TAG', {
        query: { q: 'Prioritario-e2e' },
        columns: columns('name', 'usageCount'),
      }).expect(200);
      expect(raw(res)).toBe(`${BOM}L-name,L-usageCount\r\nPrioritario-e2e,0\r\n`);
      expect(res.headers['x-export-row-count']).toBe('1');
      const logged = await prisma.activityLog.findMany({ where: { action: 'EXPORT' } });
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatchObject({ entityType: 'TAG', actorType: 'USER' });
    });

    it('is a reference read: every signed-in role may export, an anonymous caller may not', async () => {
      for (const role of ['ADMIN', 'MEMBER', 'VIEWER'] as const) {
        await exportCsv(role, 'TAG', {
          query: { q: 'Prioritario-e2e' },
          columns: columns('name'),
        }).expect(200);
      }
      await exportCsv(null, 'TAG', { query: {}, columns: columns('name') }).expect(401);
    });

    it('refuses a column outside the table whitelist', async () => {
      await exportCsv('OWNER', 'TAG', { query: {}, columns: columns('color-secret') }).expect(422);
    });
  });

  describe('TECHNOLOGY', () => {
    beforeEach(async () => {
      await prisma.technology.create({
        data: {
          id: 'tec_e2e',
          name: 'Elixir E2E',
          slug: 'elixir-e2e',
          category: 'BACKEND',
          active: true,
        },
      });
    });

    it('writes one row, with its usage count, and logs the export under SETTING', async () => {
      const res = await exportCsv('ADMIN', 'TECHNOLOGY', {
        query: { q: 'Elixir E2E' },
        columns: columns('name', 'category', 'usageCount', 'active'),
      }).expect(200);
      expect(raw(res)).toBe(
        `${BOM}L-name,L-category,L-usageCount,L-active\r\nElixir E2E,BACKEND,0,true\r\n`,
      );
      const logged = await prisma.activityLog.findMany({ where: { action: 'EXPORT' } });
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatchObject({ entityType: 'SETTING', entityId: 'TECHNOLOGY' });
    });

    it('is a reference read: every signed-in role may export, an anonymous caller may not', async () => {
      for (const role of ['OWNER', 'MEMBER', 'VIEWER'] as const) {
        await exportCsv(role, 'TECHNOLOGY', {
          query: { q: 'Elixir E2E' },
          columns: columns('slug'),
        }).expect(200);
      }
      await exportCsv(null, 'TECHNOLOGY', { query: {}, columns: columns('slug') }).expect(401);
    });
  });

  describe('ACTIVITY', () => {
    beforeEach(async () => {
      await prisma.activityLog.create({
        data: {
          id: 'act_e2e',
          actorType: 'SYSTEM',
          action: 'UPDATE',
          entityType: 'CLIENT',
          entityId: 'cli_x',
          entityLabel: 'Kairos-actividad-e2e',
          ip: '203.0.113.45',
          userAgent: 'agent-e2e',
        },
      });
    });

    it('writes one row with the masked address, never the raw one nor the user agent', async () => {
      const res = await exportCsv('OWNER', 'ACTIVITY', {
        query: { q: 'Kairos-actividad-e2e' },
        columns: columns('actor', 'action', 'entityType', 'entityLabel', 'ip'),
      }).expect(200);
      const body = raw(res);
      expect(body).toBe(
        `${BOM}L-actor,L-action,L-entityType,L-entityLabel,L-ip\r\nSYSTEM,UPDATE,CLIENT,Kairos-actividad-e2e,203.0.113.•••\r\n`,
      );
      expect(body).not.toContain('203.0.113.45');
      expect(body).not.toContain('agent-e2e');
    });

    it('does not offer the user agent as a column', async () => {
      await exportCsv('OWNER', 'ACTIVITY', { query: {}, columns: columns('userAgent') }).expect(
        422,
      );
    });

    it('logs the export under SETTING with the entity ACTIVITY', async () => {
      await exportCsv('ADMIN', 'ACTIVITY', {
        query: { q: 'Kairos-actividad-e2e' },
        columns: columns('entityLabel'),
      }).expect(200);
      const logged = await prisma.activityLog.findMany({ where: { action: 'EXPORT' } });
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatchObject({ entityType: 'SETTING', entityId: 'ACTIVITY' });
    });

    it.each(['MEMBER', 'VIEWER'] as const)(
      'refuses the %s where the list forbids',
      async (role) => {
        const res = await exportCsv(role, 'ACTIVITY', {
          query: {},
          columns: columns('entityLabel'),
        }).expect(403);
        expect(raw(res)).toContain('FORBIDDEN');
        expect(await prisma.activityLog.count({ where: { action: 'EXPORT' } })).toBe(0);
      },
    );

    it('refuses an anonymous request', async () => {
      await exportCsv(null, 'ACTIVITY', { query: {}, columns: columns('entityLabel') }).expect(401);
    });
  });
});
