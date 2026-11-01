import { describe, expect, it } from 'vitest';
import { anyOf, dateBound, hasSearchText, orderBy, searchEntryMatch } from './search-entry-page';

describe('search-entry-page (pure parts)', () => {
  it('detects a blank search text', () => {
    expect(hasSearchText(undefined)).toBe(false);
    expect(hasSearchText('  ')).toBe(false);
    expect(hasSearchText(' a ')).toBe(true);
  });

  it('matches the entry of one type over code, title, subtitle and body with parameters only', () => {
    const sql = searchEntryMatch('INVOICE', '100%');
    expect(sql.sql).toContain('FROM "SearchEntry" WHERE "entityType" = ?::"EntityType"');
    for (const column of ['code', 'title', 'subtitle', 'body']) {
      expect(sql.sql).toContain(`unaccent(lower("${column}"))`);
    }
    expect(sql.values).toEqual(['INVOICE', '100\\%', '100\\%', '100\\%', '100\\%']);
    expect(() => searchEntryMatch('INVOICE', ' ')).toThrow();
  });

  it('builds parameterized helpers and a tie-broken order', () => {
    expect(anyOf('status', ['A', 'B']).values).toEqual([['A', 'B']]);
    expect(dateBound('date', '>=', new Date('2026-01-01')).sql).toContain('"date" >=');
    expect(orderBy('date', 'desc').sql).toBe('"date" DESC, "id" ASC');
    expect(orderBy('date', 'asc').sql).toBe('"date" ASC, "id" ASC');
  });
});
