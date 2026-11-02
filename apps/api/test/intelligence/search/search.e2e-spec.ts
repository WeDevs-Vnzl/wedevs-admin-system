import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import { SearchModule } from '../../../src/modules/intelligence/search.module';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { AUTHORIZATION } from '../../../src/shared/application/ports/tokens';
import type { UserRole } from '../../../src/shared/domain/enums';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';
import { createTestApp } from '../../support/test-app';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const URL = '/api/v1/search';

/** HU-26 and HU-28 CA1 (search) over the real Nest app with module-local wiring (`SearchModule` only). */
describe('GET /search (e2e)', () => {
  const prisma = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));
  const authenticator = new FakeAuthenticator();
  const tokens = {} as Record<UserRole, string>;
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({
      modules: [SearchModule],
      authenticator,
      overrides: [{ token: AUTHORIZATION, useValue: new MatrixAuthorization() }],
    });
  });

  beforeEach(async () => {
    await truncateBusinessTables(prisma);
    for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const) {
      const row = await prisma.user.create({
        data: {
          clerkId: `clerk_search_${role}`,
          email: `search-${role.toLowerCase()}@example.test`,
          name: role,
          role,
        },
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
    await prisma.searchEntry.createMany({
      data: [
        {
          entityType: 'CLIENT',
          entityId: 'cli_kairos',
          code: 'CLI-0001',
          title: 'Kairos Studio',
          subtitle: 'Kairos Studio C.A.',
          status: 'ACTIVO',
        },
        {
          entityType: 'CLIENT',
          entityId: 'cli_garcia',
          code: 'CLI-0002',
          title: 'Talleres García',
          status: 'ACTIVO',
        },
        {
          entityType: 'CLIENT',
          entityId: 'cli_inversion',
          code: 'CLI-0003',
          title: 'Inversión Delta',
          status: 'PROSPECTO',
        },
        {
          entityType: 'CLIENT',
          entityId: 'cli_veredas',
          code: 'CLI-0004',
          title: 'Veredas Digital',
          status: 'INACTIVO',
          archived: true,
        },
        {
          entityType: 'PROJECT',
          entityId: 'pry_web',
          code: 'PRY-0001',
          title: 'Sitio web Kairos',
          subtitle: 'Kairos Studio',
          status: 'EN_CURSO',
        },
        {
          entityType: 'INVOICE',
          entityId: 'inv_3',
          code: 'FAC-0003',
          title: 'KAI-0001',
          subtitle: 'Kairos Studio',
          status: 'EMITIDA',
        },
        {
          entityType: 'INVOICE',
          entityId: 'inv_4',
          code: 'FAC-0004',
          title: 'KAI-0002',
          subtitle: 'Talleres García',
          status: 'PAGADA',
        },
        { entityType: 'ACCOUNT', entityId: 'acc_1', title: 'Banco Kairos', subtitle: 'Mercantil' },
        {
          entityType: 'NOTE',
          entityId: 'note_1',
          title: 'Minuta Kairos',
          body: 'alcance acordado',
        },
        {
          entityType: 'DOCUMENT',
          entityId: 'doc_1',
          code: 'DOC-0001',
          title: 'Contrato Kairos',
          status: 'VIGENTE',
        },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
    await truncateBusinessTables(prisma);
    await prisma.$disconnect();
  });

  const get = (query: Record<string, string | string[]>, role: UserRole = 'OWNER') =>
    request(app.getHttpServer())
      .get(URL)
      .query(query)
      .set('Authorization', `Bearer ${tokens[role]}`);
  const hits = (body: { groups: { items: { entityId: string }[] }[] }) =>
    body.groups.flatMap((group) => group.items.map((item) => item.entityId));

  it('refuses an unauthenticated call with UNAUTHENTICATED', async () => {
    const res = await request(app.getHttpServer()).get(URL).query({ q: 'kairos' }).expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  describe('HU-26', () => {
    it('CA1: "garcia" finds "García" (ignores accents)', async () => {
      const res = await get({ q: 'garcia' }).expect(200);
      expect(hits(res.body)).toContain('cli_garcia');
    });

    it('CA2 (A10): "invsion" finds "Inversión Delta" (word similarity)', async () => {
      const res = await get({ q: 'invsion' }).expect(200);
      expect(hits(res.body)).toContain('cli_inversion');
    });

    it('CA3: the exact code FAC-0003 resolves to that invoice alone', async () => {
      const res = await get({ q: 'fac-0003' }).expect(200);
      expect(res.body).toEqual({
        query: 'fac-0003',
        entityType: null,
        groups: [
          {
            entityType: 'INVOICE',
            total: 1,
            items: [
              {
                entityType: 'INVOICE',
                entityId: 'inv_3',
                code: 'FAC-0003',
                title: 'KAI-0001',
                subtitle: 'Kairos Studio',
                status: 'EMITIDA',
                archived: false,
              },
            ],
          },
        ],
      });
    });

    it('CA3: the exact fiscal invoice number resolves to that invoice alone', async () => {
      const res = await get({ q: 'kai-0002' }).expect(200);
      expect(hits(res.body)).toEqual(['inv_4']);
    });

    it('groups by type in the stable order, caps by limit and keeps each total', async () => {
      const res = await get({ q: 'kairos', limit: '3' }).expect(200);
      expect(hits(res.body)).toHaveLength(3);
      const order = res.body.groups.map((group: { entityType: string }) => group.entityType);
      const stable = [
        'CLIENT',
        'CONTACT',
        'PROJECT',
        'INVOICE',
        'PAYMENT',
        'EXPENSE',
        'ACCOUNT',
        'DOCUMENT',
        'NOTE',
      ];
      expect(order).toEqual(stable.filter((type) => order.includes(type)));
      const wide = await get({ q: 'kairos' }).expect(200);
      expect(
        wide.body.groups.find((g: { entityType: string }) => g.entityType === 'CLIENT').total,
      ).toBe(1);
    });

    it.each([
      ['c: kairos', 'CLIENT'],
      ['p: kairos', 'PROJECT'],
      ['f: kairos', 'INVOICE'],
      ['d: kairos', 'DOCUMENT'],
      ['n: kairos', 'NOTE'],
    ])('prefix "%s" searches only %s', async (q, type) => {
      const res = await get({ q }).expect(200);
      expect(res.body.entityType).toBe(type);
      expect(res.body.query).toBe('kairos');
      expect(res.body.groups.map((g: { entityType: string }) => g.entityType)).toEqual([type]);
    });

    it('entityTypes narrows the search, as repeated keys or a single one', async () => {
      const two = await get({ q: 'kairos', entityTypes: ['PROJECT', 'NOTE'] }).expect(200);
      expect(two.body.groups.map((g: { entityType: string }) => g.entityType)).toEqual([
        'PROJECT',
        'NOTE',
      ]);
      const one = await get({ q: 'kairos', entityTypes: 'ACCOUNT' }).expect(200);
      expect(hits(one.body)).toEqual(['acc_1']);
    });
  });

  describe('visibility (C13, C14)', () => {
    it.each(['MEMBER', 'VIEWER'] as const)(
      '%s gets no financial type and no error',
      async (role) => {
        const res = await get({ q: 'kairos' }, role).expect(200);
        const types = res.body.groups.map((g: { entityType: string }) => g.entityType);
        expect(types).toContain('CLIENT');
        for (const financial of ['INVOICE', 'PAYMENT', 'EXPENSE', 'ACCOUNT']) {
          expect(types).not.toContain(financial);
        }
      },
    );

    it.each(['MEMBER', 'VIEWER'] as const)(
      '%s cannot reach an invoice by its exact code',
      async (role) => {
        const res = await get({ q: 'FAC-0003' }, role).expect(200);
        expect(res.body.groups).toEqual([]);
        const prefixed = await get({ q: 'f: kai-0001' }, role).expect(200);
        expect(prefixed.body).toEqual({ query: 'kai-0001', entityType: 'INVOICE', groups: [] });
      },
    );

    it('Owner and Admin see the financial types', async () => {
      for (const role of ['OWNER', 'ADMIN'] as const) {
        const res = await get({ q: 'kairos' }, role).expect(200);
        expect(res.body.groups.map((g: { entityType: string }) => g.entityType)).toContain(
          'INVOICE',
        );
      }
    });
  });

  describe('archived (HU-28 CA1, C19)', () => {
    it('are hidden, then shown with the toggle for the trash roles', async () => {
      expect(hits((await get({ q: 'veredas' }).expect(200)).body)).toEqual([]);
      const shown = await get({ q: 'veredas', includeArchived: 'true' }).expect(200);
      expect(hits(shown.body)).toEqual(['cli_veredas']);
      expect(shown.body.groups[0].items[0].archived).toBe(true);
      const admin = await get({ q: 'veredas', includeArchived: 'true' }, 'ADMIN').expect(200);
      expect(hits(admin.body)).toEqual(['cli_veredas']);
    });

    it('stay hidden for a Member or Viewer even with the toggle', async () => {
      for (const role of ['MEMBER', 'VIEWER'] as const) {
        const res = await get({ q: 'veredas', includeArchived: 'true' }, role).expect(200);
        expect(res.body.groups).toEqual([]);
      }
    });
  });

  describe('input', () => {
    it('SQL metacharacters in q are inert', async () => {
      for (const q of [`'; DROP TABLE "SearchEntry"; --`, `a:* | !b & (c`, '%', `\\`]) {
        const res = await get({ q }).expect(200);
        expect(res.body.groups).toEqual([]);
      }
      // An injected `OR '1'='1'` is only more words to search: it never widens the match to every row.
      const res = await get({ q: `kairos' OR '1'='1` }).expect(200);
      expect(hits(res.body)).not.toContain('cli_garcia');
      expect(hits(res.body)).not.toContain('cli_inversion');
      expect(await prisma.searchEntry.count()).toBe(10);
    });

    it.each([
      [{}, 'q'],
      [{ q: '   ' }, 'q'],
      [{ q: 'a'.repeat(201) }, 'q'],
      [{ q: 'a', limit: '0' }, 'limit'],
      [{ q: 'a', limit: '51' }, 'limit'],
      [{ q: 'a', limit: 'many' }, 'limit'],
      [{ q: 'a', entityTypes: 'USER' }, 'entityTypes'],
      [{ q: 'a', includeArchived: 'maybe' }, 'includeArchived'],
    ])('rejects %j with VALIDATION on %s', async (query, field) => {
      const res = await get(query as Record<string, string>).expect(422);
      expect(res.body.error.code).toBe('VALIDATION');
      expect(Object.keys(res.body.error.fieldErrors)).toContain(field);
    });
  });
});
