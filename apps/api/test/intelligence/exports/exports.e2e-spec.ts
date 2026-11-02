import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import { ExportsModule } from '../../../src/modules/intelligence/exports.module';
import type { AuthorizationPort } from '../../../src/shared/application/ports/authorization.port';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import {
  ExportSourceRegistry,
  type ExportColumn,
  type ExportSource,
} from '../../../src/shared/application/ports/export-source.port';
import { AUTHORIZATION, CLOCK } from '../../../src/shared/application/ports/tokens';
import { ForbiddenError } from '../../../src/shared/domain/domain-error';
import type { UserRole } from '../../../src/shared/domain/enums';
import type { ListQuery } from '../../../src/shared/domain/list-query';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { createTestApp } from '../../support/test-app';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

interface Row {
  name: string;
  amount: string;
}

const columns: Record<string, ExportColumn<Row>> = {
  name: { type: 'text', value: (r) => r.name },
  amount: { type: 'money', value: (r) => r.amount },
};

/** Stands in for a list use case: it runs `can()` itself, as every real source does. */
class FakeClientSource implements ExportSource<Row> {
  readonly entity = 'CLIENT';
  readonly columns = columns;
  rows: Row[] = [];
  readonly queries: Omit<ListQuery, 'page' | 'pageSize'>[] = [];
  constructor(private readonly authorization: AuthorizationPort) {}
  async read(
    actor: CurrentUser,
    query: Omit<ListQuery, 'page' | 'pageSize'>,
    page: { page: number; pageSize: 25 | 50 | 100 },
  ) {
    // Plays a finance table: Viewer has no grant on it.
    if (!this.authorization.can(actor, 'read', 'invoice')) throw new ForbiddenError();
    this.queries.push(query);
    const start = (page.page - 1) * page.pageSize;
    return { rows: this.rows.slice(start, start + page.pageSize), total: this.rows.length };
  }
}

const URL = '/api/v1/exports';

describe('POST /exports/{entity} (e2e)', () => {
  const prisma = createTestPrisma();
  const authenticator = new FakeAuthenticator();
  const clock = new FixedClock('2026-01-16T02:00:00.000Z');
  const authorization = new MatrixAuthorization();
  const source = new FakeClientSource(authorization);
  const tokens = {} as Record<UserRole, string>;
  let app: NestExpressApplication;

  const post = (role: UserRole | null, entity: string, body: unknown) => {
    const req = request(app.getHttpServer()).post(`${URL}/${entity}`);
    return (role ? req.set('Authorization', `Bearer ${tokens[role]}`) : req).send(body as object);
  };
  const body = (over: Record<string, unknown> = {}) => ({
    query: {},
    columns: [
      { id: 'name', label: 'Nombre' },
      { id: 'amount', label: 'Monto' },
    ],
    ...over,
  });
  const rawBody = (res: request.Response): string => (res.body as Buffer).toString('utf8');
  const exportPost = (role: UserRole | null, entity: string, payload: unknown) =>
    post(role, entity, payload)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });

  beforeAll(async () => {
    app = await createTestApp({
      modules: [ExportsModule],
      authenticator,
      overrides: [
        { token: AUTHORIZATION, useValue: authorization },
        { token: CLOCK, useValue: clock },
      ],
    });
    app.get(ExportSourceRegistry, { strict: false }).register(source);
  });

  beforeEach(async () => {
    await truncateBusinessTables(prisma);
    source.rows = [{ name: 'Kairos', amount: '1234.50' }];
    source.queries.length = 0;
    for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const) {
      const row = await prisma.user.create({
        data: {
          clerkId: `clerk_exp_${role}`,
          email: `exp-${role.toLowerCase()}@example.test`,
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

  afterAll(async () => {
    await truncateBusinessTables(prisma);
    await prisma.$disconnect();
    await app.close();
  });

  it('answers the file: BOM, CRLF, money verbatim, headers of choice 3', async () => {
    const res = await exportPost('OWNER', 'CLIENT', body()).expect(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename="client-2026-01-15.csv"');
    expect(res.headers['x-export-row-count']).toBe('1');
    expect(res.headers['x-export-truncated']).toBe('false');
    expect(rawBody(res)).toBe('﻿Nombre,Monto\r\nKairos,1234.50\r\n');
    expect(rawBody(res).startsWith('﻿')).toBe(true);
  });

  it('guards formulas in cells and labels', async () => {
    source.rows = [{ name: '=cmd|"/c calc"!A1', amount: '-5.00' }];
    const res = await exportPost(
      'OWNER',
      'CLIENT',
      body({
        columns: [
          { id: 'name', label: '+SUM(A1)' },
          { id: 'amount', label: 'Monto' },
        ],
      }),
    ).expect(200);
    expect(rawBody(res)).toBe('﻿\'+SUM(A1),Monto\r\n"\'=cmd|""/c calc""!A1",-5.00\r\n');
  });

  it('cuts 10,001 rows to 10,000 plus the header and says so', async () => {
    source.rows = Array.from({ length: 10_001 }, (_, i) => ({ name: `c${i}`, amount: '1.00' }));
    const res = await exportPost('OWNER', 'CLIENT', body()).expect(200);
    expect(res.headers['x-export-row-count']).toBe('10000');
    expect(res.headers['x-export-truncated']).toBe('true');
    expect(rawBody(res).split('\r\n')).toHaveLength(10_000 + 2);
  });

  it('refuses the Viewer where the list forbids', async () => {
    const res = await exportPost('VIEWER', 'CLIENT', body()).expect(403);
    expect(rawBody(res)).toContain('FORBIDDEN');
    expect(await prisma.activityLog.count({ where: { action: 'EXPORT' } })).toBe(0);
  });

  it('refuses an anonymous request', async () => {
    await post(null, 'CLIENT', body()).expect(401);
  });

  it('writes the EXPORT entry once, without filters or labels', async () => {
    await exportPost(
      'ADMIN',
      'CLIENT',
      body({ query: { q: 'secret-term', filters: { status: 'ACTIVO' }, archived: 'only' } }),
    ).expect(200);
    const rows = await prisma.activityLog.findMany({ where: { action: 'EXPORT' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityType: 'CLIENT', entityId: 'CLIENT', actorType: 'USER' });
    expect(rows[0]?.metadata).toEqual({
      entity: 'CLIENT',
      rowCount: 1,
      columns: ['name', 'amount'],
      truncated: false,
    });
    const serialized = JSON.stringify(rows[0]);
    for (const leak of ['secret-term', 'ACTIVO', 'Nombre', 'Monto']) {
      expect(serialized).not.toContain(leak);
    }
  });

  it('passes the table query to the source', async () => {
    await exportPost(
      'OWNER',
      'CLIENT',
      body({
        query: {
          q: 'kai',
          sort: 'name:desc',
          archived: 'include',
          filters: { status: ['A', 'B'] },
        },
      }),
    ).expect(200);
    expect(source.queries[0]).toEqual({
      q: 'kai',
      sort: { field: 'name', direction: 'desc' },
      archived: 'include',
      filters: { status: ['A', 'B'] },
    });
  });

  it.each([
    ['an unknown column id', body({ columns: [{ id: 'nope', label: 'x' }] })],
    [
      'a repeated column id',
      body({
        columns: [
          { id: 'name', label: 'a' },
          { id: 'name', label: 'b' },
        ],
      }),
    ],
    ['no columns', body({ columns: [] })],
    ['a missing label', body({ columns: [{ id: 'name' }] })],
    ['a label over 200 characters', body({ columns: [{ id: 'name', label: 'x'.repeat(201) }] })],
    ['a malformed sort', body({ query: { sort: 'name' } })],
    ['an unknown archived mode', body({ query: { archived: 'maybe' } })],
    ['a missing body', undefined],
  ])('rejects %s with 422 VALIDATION and writes nothing', async (_name, payload) => {
    const res = await exportPost('OWNER', 'CLIENT', payload ?? {}).expect(422);
    expect(JSON.parse(rawBody(res)).error.code).toBe('VALIDATION');
    expect(await prisma.activityLog.count({ where: { action: 'EXPORT' } })).toBe(0);
  });

  it('rejects an entity outside the whitelist with 422', async () => {
    for (const entity of ['USER', 'client', 'TRASH']) {
      const res = await exportPost('OWNER', entity, body()).expect(422);
      expect(JSON.parse(rawBody(res)).error.code).toBe('VALIDATION');
    }
  });

  it('answers 404 for a whitelisted table without a registered source', async () => {
    const res = await exportPost('OWNER', 'NOTE', body()).expect(404);
    expect(JSON.parse(rawBody(res)).error.code).toBe('NOT_FOUND');
  });
});
