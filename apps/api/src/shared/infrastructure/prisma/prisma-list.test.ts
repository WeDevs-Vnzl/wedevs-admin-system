import { describe, expect, it } from 'vitest';
import { DEFAULT_LIST_QUERY } from '../../domain/list-query';
import { Prisma } from './generated-client';
import {
  archivedWhere,
  buildOrderBy,
  buildSearchStatements,
  escapeLike,
  searchCondition,
} from './prisma-list';

const map = {
  name: 'name',
  dueDate: { path: 'dueDate', nullable: true },
  clientName: 'client.name',
  id: 'id',
};
const fallback = { field: 'name', direction: 'asc' } as const;

describe('prisma-list (pure parts)', () => {
  it('orders nullable columns with nulls last in both directions, with an id tie-breaker', () => {
    expect(buildOrderBy({ field: 'dueDate', direction: 'asc' }, map, fallback)).toEqual([
      { dueDate: { sort: 'asc', nulls: 'last' } },
      { id: 'asc' },
    ]);
    expect(buildOrderBy({ field: 'dueDate', direction: 'desc' }, map, fallback)).toEqual([
      { dueDate: { sort: 'desc', nulls: 'last' } },
      { id: 'asc' },
    ]);
  });

  it('uses the default sort, nests dotted paths and skips the tie-breaker on id', () => {
    expect(buildOrderBy(null, map, fallback)).toEqual([{ name: 'asc' }, { id: 'asc' }]);
    expect(buildOrderBy({ field: 'clientName', direction: 'desc' }, map, fallback)[0]).toEqual({
      client: { name: 'desc' },
    });
    expect(buildOrderBy({ field: 'id', direction: 'desc' }, map, fallback)).toEqual([
      { id: 'desc' },
    ]);
  });

  it('rejects a sort field outside the map', () => {
    expect(() => buildOrderBy({ field: 'nope', direction: 'asc' }, map, fallback)).toThrow();
  });

  it('maps archived modes to a where fragment', () => {
    expect(archivedWhere('exclude')).toEqual({ deletedAt: null });
    expect(archivedWhere('only')).toEqual({ deletedAt: { not: null } });
    const include = archivedWhere('include');
    expect('deletedAt' in include).toBe(true);
    expect(include.deletedAt).toBeUndefined();
  });

  it('escapes LIKE metacharacters', () => {
    expect(escapeLike('50%_off\\x')).toBe('50\\%\\_off\\\\x');
  });

  it('builds a parameterized search condition and ignores blank text', () => {
    expect(searchCondition(['name'], '   ')).toBeNull();
    expect(searchCondition(['name'], undefined)).toBeNull();
    const sql = searchCondition(['name', 'email'], ' 100% ');
    if (!sql) throw new Error('expected a condition');
    expect(sql.values).toEqual(['100\\%', '100\\%']);
    expect(sql.sql).not.toContain('100');
    expect(sql.sql).toContain('unaccent(lower("name"))');
    expect(sql.sql).toContain('unaccent(lower("email"))');
  });

  it('refuses an unsafe column identifier', () => {
    expect(() => searchCondition(['name"; DROP TABLE x; --'], 'a')).toThrow();
  });

  describe('search statements', () => {
    const spec = {
      table: 'Client',
      searchColumns: ['tradeName'],
      sortMap: { ...map, clientName: { path: 'client.name', sql: Prisma.raw('"clientName"') } },
      defaultSort: fallback,
      query: { ...DEFAULT_LIST_QUERY, q: 'abc' },
    };
    const window = { skip: 50, take: 25 };

    it('parameterizes values and bounds the page by LIMIT/OFFSET', () => {
      const { page, count } = buildSearchStatements(spec, window);
      expect(page.sql).toContain('ORDER BY "name" ASC, "id" ASC LIMIT ? OFFSET ?');
      expect(page.sql).toContain('"deletedAt" IS NULL');
      expect(page.values).toEqual(['abc', 25, 50]);
      expect(count.sql).toContain('count(*)');
      expect(count.values).toEqual(['abc']);
    });

    it('resolves q through SearchEntry when searchEntryType is given, replacing searchColumns', () => {
      const { page, count } = buildSearchStatements({ ...spec, searchEntryType: 'CLIENT' }, window);
      expect(page.sql).toContain('"id" IN (SELECT "entityId" FROM "SearchEntry"');
      expect(page.sql).not.toContain('"tradeName"');
      expect(page.sql).toContain('"deletedAt" IS NULL');
      expect(page.values).toEqual(['CLIENT', 'abc', 'abc', 'abc', 'abc', 25, 50]);
      expect(count.values).toEqual(['CLIENT', 'abc', 'abc', 'abc', 'abc']);
    });

    it('needs no searchColumns when searchEntryType is given', () => {
      const { searchColumns: _unused, ...withoutColumns } = spec;
      const { page } = buildSearchStatements(
        { ...withoutColumns, searchEntryType: 'CLIENT' },
        window,
      );
      expect(page.sql).toContain('"SearchEntry"');
    });

    it('orders nullable columns NULLS LAST in both directions and honours archived modes', () => {
      const asc = buildSearchStatements(
        {
          ...spec,
          query: { ...spec.query, sort: { field: 'dueDate', direction: 'asc' }, archived: 'only' },
        },
        window,
      );
      expect(asc.page.sql).toContain('"dueDate" ASC NULLS LAST, "id" ASC');
      expect(asc.page.sql).toContain('"deletedAt" IS NOT NULL');
      const desc = buildSearchStatements(
        {
          ...spec,
          query: {
            ...spec.query,
            sort: { field: 'dueDate', direction: 'desc' },
            archived: 'include',
          },
        },
        window,
      );
      expect(desc.page.sql).toContain('"dueDate" DESC NULLS LAST, "id" ASC');
      expect(desc.page.sql).not.toContain('deletedAt');
    });

    it('requires an sql expression for relation sorts and sqlWhere next to filters', () => {
      expect(() =>
        buildSearchStatements(
          {
            ...spec,
            sortMap: map,
            query: { ...spec.query, sort: { field: 'clientName', direction: 'asc' } },
          },
          window,
        ),
      ).toThrow(/sql/);
      expect(() => buildSearchStatements({ ...spec, where: { kind: 'X' } }, window)).toThrow(
        /sqlWhere/,
      );
      const withFilter = buildSearchStatements(
        { ...spec, where: { kind: 'X' }, sqlWhere: Prisma.sql`"kind" = ${'X'}` },
        window,
      );
      expect(withFilter.page.values).toEqual(['X', 'abc', 25, 50]);
    });
  });
});
